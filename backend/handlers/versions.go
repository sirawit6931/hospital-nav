package handlers

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

type MapVersionSummary struct {
	ID            uint      `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	IsLive        bool      `json:"is_live"`
	NodeCount     int64     `json:"node_count"`
	BuildingCount int64     `json:"building_count"`
	EdgeCount     int64     `json:"edge_count"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type mapVersionMetaRequest struct {
	Name              string `json:"name"`
	Description       string `json:"description"`
	KeepBuildingsOnly bool   `json:"keep_buildings_only"`
}

// ResolveLiveVersionID returns the ID of the currently live map version.
func ResolveLiveVersionID() (uint, error) {
	var live models.MapVersion
	if err := config.DB.Where("is_live = ?", true).Order("id ASC").First(&live).Error; err == nil && live.ID > 0 {
		return live.ID, nil
	}
	if err := config.DB.Order("id ASC").First(&live).Error; err == nil && live.ID > 0 {
		return live.ID, nil
	}
	return 0, errors.New("ไม่พบข้อมูลเวอร์ชันแผนที่ในระบบ")
}

// ResolveRequestedVersionID parses the given query param (e.g. version_id or preview_version_id)
// and verifies it exists; if omitted, falls back to the current Live version ID.
func ResolveRequestedVersionID(c *gin.Context, queryKeys ...string) (uint, error) {
	for _, key := range queryKeys {
		raw := strings.TrimSpace(c.Query(key))
		if raw == "" {
			continue
		}
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || parsed == 0 {
			return 0, fmt.Errorf("พารามิเตอร์ %s ไม่ถูกต้อง", key)
		}
		var v models.MapVersion
		if err := config.DB.First(&v, uint(parsed)).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return 0, fmt.Errorf("ไม่พบเวอร์ชันแผนที่ #%d", parsed)
			}
			return 0, err
		}
		return v.ID, nil
	}
	return ResolveLiveVersionID()
}

func buildVersionSummary(v models.MapVersion) MapVersionSummary {
	var nodeCount, buildingCount, edgeCount int64
	config.DB.Model(&models.MapNode{}).Where("version_id = ?", v.ID).Count(&nodeCount)
	config.DB.Model(&models.MapNode{}).Where("version_id = ? AND is_building = ?", v.ID, true).Count(&buildingCount)
	config.DB.Model(&models.MapEdge{}).Where("version_id = ?", v.ID).Count(&edgeCount)

	return MapVersionSummary{
		ID:            v.ID,
		Name:          v.Name,
		Description:   v.Description,
		IsLive:        v.IsLive,
		NodeCount:     nodeCount,
		BuildingCount: buildingCount,
		EdgeCount:     edgeCount,
		CreatedAt:     v.CreatedAt,
		UpdatedAt:     v.UpdatedAt,
	}
}

// GetMapVersions returns all map versions with live status and node/edge counts.
func GetMapVersions(c *gin.Context) {
	versions := make([]models.MapVersion, 0)
	if err := config.DB.Order("is_live DESC, id ASC").Find(&versions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงรายการเวอร์ชันแผนที่ได้"})
		return
	}

	summaries := make([]MapVersionSummary, 0, len(versions))
	for _, v := range versions {
		summaries = append(summaries, buildVersionSummary(v))
	}

	c.JSON(http.StatusOK, summaries)
}

// CloneMapVersion deep-copies map_nodes, departments, map_edges (with remapped node IDs),
// and 3D model overrides from the source version into a new Draft version.
func CloneMapVersion(c *gin.Context) {
	srcID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || srcID64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสเวอร์ชันต้นแบบไม่ถูกต้อง"})
		return
	}
	srcVersionID := uint(srcID64)

	var req mapVersionMetaRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบข้อมูลเวอร์ชันใหม่ไม่ถูกต้อง"})
		return
	}

	var srcVersion models.MapVersion
	if err := config.DB.First(&srcVersion, srcVersionID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบเวอร์ชันต้นแบบที่ต้องการคัดลอก"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถตรวจสอบเวอร์ชันต้นแบบได้"})
		return
	}

	newName := strings.TrimSpace(req.Name)
	if newName == "" {
		newName = fmt.Sprintf("ฉบับร่างจาก %s (%s)", srcVersion.Name, time.Now().Format("02/01 15:04"))
	}
	newDesc := strings.TrimSpace(req.Description)
	if newDesc == "" {
		newDesc = fmt.Sprintf("คัดลอกจากเวอร์ชัน #%d (%s)", srcVersion.ID, srcVersion.Name)
	}

	var createdVersion models.MapVersion
	oldToNewNodeID := make(map[uint]uint)

	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		createdVersion = models.MapVersion{
			Name:        newName,
			Description: newDesc,
			IsLive:      false,
		}
		if err := tx.Create(&createdVersion).Error; err != nil {
			return err
		}

		// 1. Clone map_nodes from source version (optionally keeping only green buildings so admin can draw fresh paths)
		var srcNodes []models.MapNode
		nodeQuery := tx.Where("version_id = ?", srcVersionID)
		if req.KeepBuildingsOnly {
			nodeQuery = nodeQuery.Where("is_building = ?", true)
		}
		if err := nodeQuery.Order("id ASC").Find(&srcNodes).Error; err != nil {
			return err
		}

		for _, n := range srcNodes {
			imgJSON := string(n.ImageURLs)
			if strings.TrimSpace(imgJSON) == "" || strings.TrimSpace(imgJSON) == "null" {
				imgJSON = "[]"
			}
			var newNodeID uint
			if err := tx.Raw(`
				INSERT INTO map_nodes (version_id, name, is_building, building_code, badge_label, floor_range, service_status, category_id, keywords, indoor_guide, image_url, image_urls, lat, lng, geom)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))
				RETURNING id
			`,
				createdVersion.ID,
				n.Name,
				n.IsBuilding,
				n.BuildingCode,
				n.BadgeLabel,
				n.FloorRange,
				n.ServiceStatus,
				n.CategoryID,
				n.Keywords,
				n.IndoorGuide,
				n.ImageURL,
				imgJSON,
				n.Lat,
				n.Lng,
				n.Lng,
				n.Lat,
			).Scan(&newNodeID).Error; err != nil {
				return err
			}
			oldToNewNodeID[n.ID] = newNodeID
		}

		// 2. Clone departments linked to source nodes so cloned buildings retain full department data
		if len(srcNodes) > 0 {
			srcNodeIDs := make([]uint, 0, len(srcNodes))
			for _, n := range srcNodes {
				srcNodeIDs = append(srcNodeIDs, n.ID)
			}
			var srcDepts []models.Department
			if err := tx.Where("node_id IN ?", srcNodeIDs).Order("id ASC").Find(&srcDepts).Error; err != nil {
				return err
			}
			if len(srcDepts) > 0 {
				clonedDepts := make([]models.Department, 0, len(srcDepts))
				for _, d := range srcDepts {
					if mappedNodeID, ok := oldToNewNodeID[d.NodeID]; ok {
						clonedDepts = append(clonedDepts, models.Department{
							NodeID:         mappedNodeID,
							Name:           d.Name,
							Floor:          d.Floor,
							OperatingHours: d.OperatingHours,
							Phone:          d.Phone,
							Keywords:       d.Keywords,
						})
					}
				}
				if len(clonedDepts) > 0 {
					if err := tx.Create(&clonedDepts).Error; err != nil {
						return err
					}
				}
			}
		}

		// 3. Clone all map_edges with remapped from_node / to_node and PostGIS LineString geom
		// (Skipped when KeepBuildingsOnly is true so admin starts with a clean path canvas)
		var srcEdges []models.MapEdge
		if !req.KeepBuildingsOnly {
			if err := tx.Where("version_id = ?", srcVersionID).Order("id ASC").Find(&srcEdges).Error; err != nil {
				return err
			}
		}
		for _, e := range srcEdges {
			newFrom, okFrom := oldToNewNodeID[e.FromNode]
			newTo, okTo := oldToNewNodeID[e.ToNode]
			if !okFrom || !okTo {
				continue
			}
			if err := tx.Exec(`
				INSERT INTO map_edges (
					version_id, from_node, to_node, distance_m, instruction,
					is_wheelchair_friendly, is_active, is_covered, is_indoor_passthrough, closure_reason, geom
				)
				SELECT
					?,
					a.id,
					b.id,
					ST_Distance(a.geom::geography, b.geom::geography),
					?,
					?,
					?,
					?,
					?,
					?,
					ST_MakeLine(a.geom, b.geom)
				FROM map_nodes AS a, map_nodes AS b
				WHERE a.id = ? AND b.id = ?
			`,
				createdVersion.ID,
				e.Instruction,
				e.IsWheelchairFriendly,
				e.IsActive,
				e.IsCovered,
				e.IsIndoorPassthrough,
				e.ClosureReason,
				newFrom,
				newTo,
			).Error; err != nil {
				return err
			}
		}

		return nil
	})
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถคัดลอกเวอร์ชันแผนที่ได้: " + txErr.Error()})
		return
	}

	// 4. Deep-copy 3D model overrides JSON and remap linked_node_id
	if err := cloneMap3DOverridesFile(srcVersionID, createdVersion.ID, oldToNewNodeID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "คัดลอกข้อมูลจุดและเส้นแล้ว แต่ไม่สามารถคัดลอกโมเดล 3D ได้"})
		return
	}

	c.JSON(http.StatusCreated, buildVersionSummary(createdVersion))
}

// UpdateMapVersion updates name and description of a map version.
func UpdateMapVersion(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสเวอร์ชันไม่ถูกต้อง"})
		return
	}

	var req mapVersionMetaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบข้อมูลไม่ถูกต้อง"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาระบุชื่อเวอร์ชันแผนที่"})
		return
	}

	var version models.MapVersion
	if err := config.DB.First(&version, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบเวอร์ชันแผนที่ที่ต้องการแก้ไข"})
		return
	}

	version.Name = name
	version.Description = strings.TrimSpace(req.Description)
	if err := config.DB.Save(&version).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกชื่อเวอร์ชันได้"})
		return
	}

	c.JSON(http.StatusOK, buildVersionSummary(version))
}

// PublishMapVersion atomically marks the specified version as Live (is_live = true)
// and demotes all other versions to Draft (is_live = false) inside a transaction.
func PublishMapVersion(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสเวอร์ชันไม่ถูกต้อง"})
		return
	}

	var target models.MapVersion
	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&target, uint(id)).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.MapVersion{}).Where("is_live = ?", true).Update("is_live", false).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.MapVersion{}).Where("id = ?", target.ID).Updates(map[string]any{
			"is_live":    true,
			"updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}
		target.IsLive = true
		return nil
	})
	if txErr != nil {
		if errors.Is(txErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบเวอร์ชันแผนที่ที่ต้องการเผยแพร่"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถตั้งค่าเวอร์ชันใช้งานจริงได้"})
		return
	}

	// Keep legacy uploads/custom_3d_overrides.json in sync with the newly Live version
	syncLiveMap3DLegacyFile(target.ID)

	c.JSON(http.StatusOK, buildVersionSummary(target))
}

// DeleteMapVersion deletes a non-live Draft map version along with its nodes, edges, departments, and 3D file.
func DeleteMapVersion(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสเวอร์ชันไม่ถูกต้อง"})
		return
	}

	var target models.MapVersion
	if err := config.DB.First(&target, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบเวอร์ชันแผนที่ที่ต้องการลบ"})
		return
	}
	if target.IsLive {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "ไม่สามารถลบเวอร์ชันที่กำลังใช้งานจริง (Live) ได้ กรุณาสลับไปใช้เวอร์ชันอื่นก่อน",
		})
		return
	}

	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		var nodeIDs []uint
		if err := tx.Model(&models.MapNode{}).Where("version_id = ?", target.ID).Pluck("id", &nodeIDs).Error; err != nil {
			return err
		}
		if err := tx.Where("version_id = ?", target.ID).Delete(&models.MapEdge{}).Error; err != nil {
			return err
		}
		if len(nodeIDs) > 0 {
			if err := tx.Where("node_id IN ?", nodeIDs).Delete(&models.Department{}).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.ServicePoint{}).Where("node_id IN ?", nodeIDs).Update("node_id", nil).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("version_id = ?", target.ID).Delete(&models.MapNode{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.MapVersion{}, target.ID).Error
	})
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบเวอร์ชันแผนที่ได้"})
		return
	}

	// Clean up versioned 3D overrides file if it exists
	_ = os.Remove(map3DVersionFilePath(target.ID))

	c.JSON(http.StatusOK, gin.H{
		"message": "ลบเวอร์ชันแผนที่เรียบร้อยแล้ว",
		"id":      target.ID,
	})
}

// ClearVersionPaths removes all map_edges and non-building junction nodes (is_building = false)
// in a Draft map version while keeping all green building nodes (is_building = true) and their departments intact.
func ClearVersionPaths(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสเวอร์ชันไม่ถูกต้อง"})
		return
	}

	var target models.MapVersion
	if err := config.DB.First(&target, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบเวอร์ชันแผนที่"})
		return
	}
	if target.IsLive {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "ไม่สามารถล้างเส้นทางบนเวอร์ชันใช้งานจริง (Live) โดยตรงได้ กรุณาคัดลอกเป็นฉบับร่างก่อน",
		})
		return
	}

	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("version_id = ?", target.ID).Delete(&models.MapEdge{}).Error; err != nil {
			return err
		}
		if err := tx.Where("version_id = ? AND is_building = ?", target.ID, false).Delete(&models.MapNode{}).Error; err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถล้างเส้นทางเดิมได้"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "ล้างเส้นทางและจุดทางแยกเดิมเรียบร้อยแล้ว (ข้อมูลตึกสีเขียวอยู่ครบทั้งหมด)",
		"version": buildVersionSummary(target),
	})
}
