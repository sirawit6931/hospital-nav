package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

type nodeRequest struct {
	Name          string    `json:"name"`
	IsBuilding    bool      `json:"is_building"`
	BuildingCode  *string   `json:"building_code"`
	BadgeLabel    *string   `json:"badge_label"`
	FloorRange    *string   `json:"floor_range"`
	ServiceStatus *string   `json:"service_status"`
	CategoryID    *uint     `json:"category_id"`
	ClearCategory bool      `json:"clear_category"`
	Keywords      string    `json:"keywords"`
	IndoorGuide   string    `json:"indoor_guide"`
	ImageURL      string    `json:"image_url"`
	ImageURLs     *[]string `json:"image_urls"`
	Lat           *float64  `json:"lat" binding:"required"`
	Lng           *float64  `json:"lng" binding:"required"`
}

func sanitizeImageURLs(urls []string, coverURL string) ([]string, string) {
	seen := make(map[string]struct{}, len(urls)+1)
	clean := make([]string, 0, len(urls)+1)
	cover := strings.TrimSpace(coverURL)

	for _, u := range urls {
		trimmed := strings.TrimSpace(u)
		if trimmed == "" {
			continue
		}
		if _, dup := seen[trimmed]; dup {
			continue
		}
		seen[trimmed] = struct{}{}
		clean = append(clean, trimmed)
	}

	if cover != "" {
		if _, exists := seen[cover]; !exists {
			clean = append([]string{cover}, clean...)
		}
	} else if len(clean) > 0 {
		cover = clean[0]
	}
	return clean, cover
}

func parseNodeImageURLs(raw models.JSONB) []string {
	if len(raw) == 0 {
		return nil
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil
	}
	return list
}

func encodeImageURLsJSON(urls []string) string {
	if len(urls) == 0 {
		return "[]"
	}
	b, err := json.Marshal(urls)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func normalizeServiceStatus(raw string) string {
	switch strings.TrimSpace(raw) {
	case "open_24h", "maintenance", "open":
		return strings.TrimSpace(raw)
	default:
		return "open"
	}
}

func validateCoordinates(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// SearchBuildings returns public building nodes (is_building = true) with attached departments,
// scoped to the active Live map version (or ?preview_version_id=ID for admin preview).
func SearchBuildings(c *gin.Context) {
	versionID, err := ResolveRequestedVersionID(c, "preview_version_id", "version_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	q := strings.TrimSpace(c.Query("q"))

	query := config.DB.Model(&models.MapNode{}).
		Preload("Departments", func(db *gorm.DB) *gorm.DB {
			return db.Order("floor ASC, name ASC, id ASC")
		}).
		Where("version_id = ? AND is_building = ?", versionID, true)
	if q != "" {
		pattern := "%" + q + "%"
		query = query.Where(
			`name ILIKE ? OR COALESCE(keywords, '') ILIKE ? OR COALESCE(indoor_guide, '') ILIKE ?
			 OR COALESCE(building_code, '') ILIKE ? OR COALESCE(badge_label, '') ILIKE ?
			 OR EXISTS (
				SELECT 1 FROM departments d
				WHERE d.node_id = map_nodes.id
				  AND (d.name ILIKE ? OR COALESCE(d.keywords, '') ILIKE ? OR COALESCE(d.floor, '') ILIKE ?)
			 )`,
			pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern,
		)
	}

	buildings := make([]models.MapNode, 0)
	if err := query.Order("name ASC, id ASC").Find(&buildings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch buildings",
		})
		return
	}

	c.JSON(http.StatusOK, buildings)
}

// GetPublicNodeByID returns any map node (building or walkway junction) by ID,
// used for QR Code start_node deep-linking and service-point navigation.
func GetPublicNodeByID(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var node models.MapNode
	if err := config.DB.Preload("Departments", func(db *gorm.DB) *gorm.DB {
		return db.Order("floor ASC, name ASC, id ASC")
	}).First(&node, uint(id)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบจุดพิกัดที่ระบุในระบบ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch node"})
		return
	}

	c.JSON(http.StatusOK, node)
}

// GetAllNodes returns map nodes (both buildings and road intersections) for admin management,
// scoped to ?version_id=... (defaults to the current Live version).
func GetAllNodes(c *gin.Context) {
	versionID, err := ResolveRequestedVersionID(c, "version_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	nodes := make([]models.MapNode, 0)
	if err := config.DB.Where("version_id = ?", versionID).Order("id ASC").Find(&nodes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch map nodes",
		})
		return
	}

	c.JSON(http.StatusOK, nodes)
}

// CreateNode creates a new map node in the specified ?version_id=... (or Live version)
// and automatically computes PostGIS geom using ST_MakePoint(lng, lat).
func CreateNode(c *gin.Context) {
	versionID, err := ResolveRequestedVersionID(c, "version_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var req nodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid node payload (lat and lng are required)",
		})
		return
	}

	if !validateCoordinates(*req.Lat, *req.Lng) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Coordinates out of range: lat must be [-90, 90] and lng must be [-180, 180]",
		})
		return
	}

	buildingCode := ""
	if req.BuildingCode != nil {
		buildingCode = strings.TrimSpace(*req.BuildingCode)
	}
	badgeLabel := ""
	if req.BadgeLabel != nil {
		badgeLabel = strings.TrimSpace(*req.BadgeLabel)
	}
	floorRange := ""
	if req.FloorRange != nil {
		floorRange = strings.TrimSpace(*req.FloorRange)
	}
	serviceStatus := "open"
	if req.ServiceStatus != nil {
		serviceStatus = normalizeServiceStatus(*req.ServiceStatus)
	}
	var categoryID *uint
	if req.CategoryID != nil && *req.CategoryID > 0 {
		v := *req.CategoryID
		categoryID = &v
	}

	var reqImageList []string
	if req.ImageURLs != nil {
		reqImageList = *req.ImageURLs
	}
	cleanImages, coverImage := sanitizeImageURLs(reqImageList, req.ImageURL)
	imagesJSON := encodeImageURLsJSON(cleanImages)

	var created models.MapNode
	err = config.DB.Raw(`
		INSERT INTO map_nodes (version_id, name, is_building, building_code, badge_label, floor_range, service_status, category_id, keywords, indoor_guide, image_url, image_urls, lat, lng, geom)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))
		RETURNING id, version_id, name, is_building, building_code, badge_label, floor_range, service_status, category_id, keywords, indoor_guide, image_url, image_urls, lat, lng, created_at
	`,
		versionID,
		strings.TrimSpace(req.Name),
		req.IsBuilding,
		buildingCode,
		badgeLabel,
		floorRange,
		serviceStatus,
		categoryID,
		strings.TrimSpace(req.Keywords),
		strings.TrimSpace(req.IndoorGuide),
		coverImage,
		imagesJSON,
		*req.Lat,
		*req.Lng,
		*req.Lng, // PostGIS ST_MakePoint takes (longitude, latitude)
		*req.Lat,
	).Scan(&created).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create map node",
		})
		return
	}

	actionLabel := "อัปเดตแผนที่ 3D"
	badge := "MAP 3D"
	title := created.Name
	if created.IsBuilding {
		actionLabel = "เพิ่มตึกใหม่"
		if created.BadgeLabel != "" {
			badge = created.BadgeLabel
		} else {
			badge = "อาคาร"
		}
	}
	if title == "" {
		title = fmt.Sprintf("จุดพิกัด #%d", created.ID)
	}
	RecordAuditLog(c, AuditEntry{
		ActionType:  "node_create",
		ActionLabel: actionLabel,
		EntityType:  "node",
		EntityID:    created.ID,
		BadgeText:   badge,
		TargetTitle: title,
		Summary:     fmt.Sprintf("เพิ่ม%s \"%s\" ลงในระบบ", map[bool]string{true: "อาคาร", false: "จุดเชื่อมต่อแผนที่"}[created.IsBuilding], title),
		Before:      nil,
		After:       created,
	})

	c.JSON(http.StatusCreated, created)
}

// UpdateNode updates an existing map node, recalculates its PostGIS geom, and refreshes connected edges.
func UpdateNode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid node ID",
		})
		return
	}

	var req nodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid node payload (lat and lng are required)",
		})
		return
	}

	if !validateCoordinates(*req.Lat, *req.Lng) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Coordinates out of range: lat must be [-90, 90] and lng must be [-180, 180]",
		})
		return
	}

	var before models.MapNode
	if err := config.DB.First(&before, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch existing node"})
		return
	}

	nextCode := before.BuildingCode
	if req.BuildingCode != nil {
		nextCode = strings.TrimSpace(*req.BuildingCode)
	}
	nextBadge := before.BadgeLabel
	if req.BadgeLabel != nil {
		nextBadge = strings.TrimSpace(*req.BadgeLabel)
	}
	nextFloors := before.FloorRange
	if req.FloorRange != nil {
		nextFloors = strings.TrimSpace(*req.FloorRange)
	}
	nextStatus := before.ServiceStatus
	if req.ServiceStatus != nil {
		nextStatus = normalizeServiceStatus(*req.ServiceStatus)
	}
	nextCategoryID := before.CategoryID
	if req.ClearCategory {
		nextCategoryID = nil
	} else if req.CategoryID != nil {
		if *req.CategoryID == 0 {
			nextCategoryID = nil
		} else {
			v := *req.CategoryID
			nextCategoryID = &v
		}
	}

	var nextImages []string
	var nextCover string
	if req.ImageURLs != nil {
		nextImages, nextCover = sanitizeImageURLs(*req.ImageURLs, req.ImageURL)
	} else {
		existingImages := parseNodeImageURLs(before.ImageURLs)
		trimmedCover := strings.TrimSpace(req.ImageURL)
		if trimmedCover != "" {
			nextImages, nextCover = sanitizeImageURLs(existingImages, trimmedCover)
		} else if before.ImageURL != "" && trimmedCover == "" {
			// Caller explicitly cleared single image_url without passing image_urls
			filtered := make([]string, 0, len(existingImages))
			for _, u := range existingImages {
				if u != before.ImageURL {
					filtered = append(filtered, u)
				}
			}
			nextImages, nextCover = sanitizeImageURLs(filtered, "")
		} else {
			nextImages, nextCover = sanitizeImageURLs(existingImages, before.ImageURL)
		}
	}
	nextImagesJSON := encodeImageURLsJSON(nextImages)

	var updated models.MapNode
	err = config.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Raw(`
			UPDATE map_nodes
			SET name = ?,
			    is_building = ?,
			    building_code = ?,
			    badge_label = ?,
			    floor_range = ?,
			    service_status = ?,
			    category_id = ?,
			    keywords = ?,
			    indoor_guide = ?,
			    image_url = ?,
			    image_urls = ?::jsonb,
			    lat = ?,
			    lng = ?,
			    geom = ST_SetSRID(ST_MakePoint(?, ?), 4326)
			WHERE id = ?
			RETURNING id, version_id, name, is_building, building_code, badge_label, floor_range, service_status, category_id, keywords, indoor_guide, image_url, image_urls, lat, lng, created_at
		`,
			strings.TrimSpace(req.Name),
			req.IsBuilding,
			nextCode,
			nextBadge,
			nextFloors,
			nextStatus,
			nextCategoryID,
			strings.TrimSpace(req.Keywords),
			strings.TrimSpace(req.IndoorGuide),
			nextCover,
			nextImagesJSON,
			*req.Lat,
			*req.Lng,
			*req.Lng, // PostGIS ST_MakePoint takes (longitude, latitude)
			*req.Lat,
			id,
		).Scan(&updated)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		// Keep connected edges' distance_m and LineString geom in sync when a node moves.
		if err := tx.Exec(`
			UPDATE map_edges AS e
			SET distance_m = ST_Distance(a.geom::geography, b.geom::geography),
			    geom = ST_MakeLine(a.geom, b.geom)
			FROM map_nodes AS a, map_nodes AS b
			WHERE e.from_node = a.id
			  AND e.to_node = b.id
			  AND (e.from_node = ? OR e.to_node = ?)
		`, id, id).Error; err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Node not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update map node",
		})
		return
	}

	// Build concise Thai diff summary for Audit Log
	moved := math.Abs(before.Lat-updated.Lat) > 1e-6 || math.Abs(before.Lng-updated.Lng) > 1e-6
	statusChanged := before.ServiceStatus != updated.ServiceStatus
	title := updated.Name
	if title == "" {
		title = fmt.Sprintf("จุดพิกัด #%d", updated.ID)
	}
	badge := updated.BadgeLabel
	if badge == "" {
		if updated.IsBuilding {
			badge = updated.BuildingCode
		} else {
			badge = "MAP 3D"
		}
	}

	actionType := "node_update"
	actionLabel := "แก้ไขข้อมูลตึก"
	changes := make([]string, 0)
	if statusChanged && before.Name == updated.Name && !moved && before.IndoorGuide == updated.IndoorGuide && before.Keywords == updated.Keywords && before.ImageURL == updated.ImageURL {
		actionType = "status_change"
		actionLabel = "เปลี่ยนสถานะบริการ"
		changes = append(changes, fmt.Sprintf("เปลี่ยนสถานะจาก \"%s\" เป็น \"%s\"", ServiceStatusThaiLabel(before.ServiceStatus), ServiceStatusThaiLabel(updated.ServiceStatus)))
	} else {
		if moved && !updated.IsBuilding {
			actionLabel = "อัปเดตแผนที่ 3D"
		} else if moved && before.Name == updated.Name && !statusChanged {
			actionLabel = "อัปเดตแผนที่ 3D"
		}
		if before.Name != updated.Name {
			changes = append(changes, fmt.Sprintf("เปลี่ยนชื่อเป็น \"%s\"", updated.Name))
		}
		if statusChanged {
			changes = append(changes, fmt.Sprintf("สถานะ: %s", ServiceStatusThaiLabel(updated.ServiceStatus)))
		}
		if before.FloorRange != updated.FloorRange {
			changes = append(changes, fmt.Sprintf("จำนวนชั้น: %s", updated.FloorRange))
		}
		if before.BuildingCode != updated.BuildingCode {
			changes = append(changes, fmt.Sprintf("รหัสอาคาร: %s", updated.BuildingCode))
		}
		if before.ImageURL != updated.ImageURL {
			changes = append(changes, "อัปเดตรูปภาพอาคาร")
		}
		if moved {
			changes = append(changes, "ปรับตำแหน่งพิกัดบนแผนที่ 3D")
		}
		if len(changes) == 0 {
			changes = append(changes, "อัปเดตรายละเอียดข้อมูลอาคาร")
		}
	}

	RecordAuditLog(c, AuditEntry{
		ActionType:  actionType,
		ActionLabel: actionLabel,
		EntityType:  "node",
		EntityID:    updated.ID,
		BadgeText:   badge,
		TargetTitle: title,
		Summary:     strings.Join(changes, " • "),
		Before:      before,
		After:       updated,
	})

	c.JSON(http.StatusOK, updated)
}

// DeleteNode safely deletes a node, its connected edges, linked departments, and detaches service points inside a transaction.
func DeleteNode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid node ID",
		})
		return
	}

	var before models.MapNode
	if err := config.DB.First(&before, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch node"})
		return
	}

	err = config.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Remove connected edges
		if err := tx.Where("from_node = ? OR to_node = ?", id, id).Delete(&models.MapEdge{}).Error; err != nil {
			return err
		}
		// 2. Remove departments belonging to this building node
		if err := tx.Where("node_id = ?", id).Delete(&models.Department{}).Error; err != nil {
			return err
		}
		// 3. Detach service_points safely (node_id is nullable)
		if err := tx.Model(&models.ServicePoint{}).Where("node_id = ?", id).Update("node_id", nil).Error; err != nil {
			return err
		}

		result := tx.Delete(&models.MapNode{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Node not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete map node",
		})
		return
	}

	title := before.Name
	if title == "" {
		title = fmt.Sprintf("จุดพิกัด #%d", before.ID)
	}
	RecordAuditLog(c, AuditEntry{
		ActionType:  "node_delete",
		ActionLabel: map[bool]string{true: "ลบข้อมูลตึก", false: "อัปเดตแผนที่ 3D"}[before.IsBuilding],
		EntityType:  "node",
		EntityID:    before.ID,
		BadgeText:   before.BadgeLabel,
		TargetTitle: title,
		Summary:     fmt.Sprintf("ลบ \"%s\" ออกจากแผนที่", title),
		Before:      before,
		After:       nil,
	})

	c.JSON(http.StatusOK, gin.H{
		"message": "Node deleted successfully",
		"id":      id,
	})
}
