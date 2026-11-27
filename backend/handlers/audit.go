package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

// AuditEntry carries structured metadata for recording an admin action into audit_logs.
type AuditEntry struct {
	ActionType  string
	ActionLabel string
	EntityType  string
	EntityID    uint
	BadgeText   string
	TargetTitle string
	Summary     string
	Before      any
	After       any
}

func marshalAuditJSON(v any) models.JSONB {
	if v == nil {
		return models.JSONB("null")
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return models.JSONB("null")
	}
	return models.JSONB(raw)
}

func resolveActorName(c *gin.Context) string {
	if c == nil {
		return "ระบบ"
	}
	if username, ok := c.Get("admin_username"); ok {
		if s, okStr := username.(string); okStr && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return "Admin"
}

// ServiceStatusThaiLabel converts a service_status code into a Thai display label.
func ServiceStatusThaiLabel(status string) string {
	switch strings.TrimSpace(status) {
	case "open_24h":
		return "เปิด 24 ชั่วโมง"
	case "maintenance":
		return "ปิดปรับปรุง"
	default:
		return "เปิดบริการปกติ"
	}
}

// RecordAuditLog writes an audit entry asynchronously-safe (best effort; never fails the main request).
func RecordAuditLog(c *gin.Context, entry AuditEntry) {
	if config.DB == nil {
		return
	}
	row := models.AuditLog{
		ActionType:  strings.TrimSpace(entry.ActionType),
		ActionLabel: strings.TrimSpace(entry.ActionLabel),
		EntityType:  strings.TrimSpace(entry.EntityType),
		EntityID:    entry.EntityID,
		BadgeText:   strings.TrimSpace(entry.BadgeText),
		TargetTitle: strings.TrimSpace(entry.TargetTitle),
		Summary:     strings.TrimSpace(entry.Summary),
		ActorName:   resolveActorName(c),
		BeforeJSON:  marshalAuditJSON(entry.Before),
		AfterJSON:   marshalAuditJSON(entry.After),
	}
	if err := config.DB.Create(&row).Error; err != nil {
		log.Printf("Warning: failed to record audit log (%s): %v", entry.ActionType, err)
	}
}

// GetAuditLogs returns admin change history with optional search (?q=), date (?date=YYYY-MM-DD), and ?action_type=.
func GetAuditLogs(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	dateStr := strings.TrimSpace(c.Query("date"))
	actionType := strings.TrimSpace(c.Query("action_type"))

	query := config.DB.Model(&models.AuditLog{})
	if q != "" {
		pattern := "%" + q + "%"
		query = query.Where(
			"target_title ILIKE ? OR summary ILIKE ? OR actor_name ILIKE ? OR action_label ILIKE ? OR badge_text ILIKE ?",
			pattern, pattern, pattern, pattern, pattern,
		)
	}
	if actionType != "" && actionType != "all" {
		query = query.Where("action_type = ?", actionType)
	}
	if dateStr != "" {
		if parsed, err := time.Parse("2006-01-02", dateStr); err == nil {
			nextDay := parsed.Add(24 * time.Hour)
			query = query.Where("created_at >= ? AND created_at < ?", parsed, nextDay)
		}
	}

	logs := make([]models.AuditLog, 0)
	if err := query.Order("created_at DESC, id DESC").Limit(200).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงประวัติการแก้ไขได้"})
		return
	}
	c.JSON(http.StatusOK, logs)
}

func isNullJSONB(b models.JSONB) bool {
	s := strings.TrimSpace(string(b))
	return s == "" || s == "null" || s == "{}"
}

// RollbackAuditLog restores the entity state stored in before_json (or reverses create/delete)
// and records a new rollback entry in audit_logs.
func RollbackAuditLog(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสประวัติการแก้ไขไม่ถูกต้อง"})
		return
	}

	var logRow models.AuditLog
	if err := config.DB.First(&logRow, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบรายการประวัติที่ต้องการย้อนกลับ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลประวัติได้"})
		return
	}

	if logRow.IsRolledBack {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รายการนี้ถูกย้อนกลับค่าเดิมไปแล้ว"})
		return
	}
	if logRow.ActionType == "rollback" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่สามารถย้อนกลับซ้ำบนรายการย้อนกลับได้"})
		return
	}

	isCreate := strings.HasSuffix(logRow.ActionType, "_create")
	isDelete := strings.HasSuffix(logRow.ActionType, "_delete")

	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		switch logRow.EntityType {
		case "node":
			if isCreate {
				if err := tx.Where("from_node = ? OR to_node = ?", logRow.EntityID, logRow.EntityID).Delete(&models.MapEdge{}).Error; err != nil {
					return err
				}
				if err := tx.Where("node_id = ?", logRow.EntityID).Delete(&models.Department{}).Error; err != nil {
					return err
				}
				if err := tx.Model(&models.ServicePoint{}).Where("node_id = ?", logRow.EntityID).Update("node_id", nil).Error; err != nil {
					return err
				}
				if err := tx.Delete(&models.MapNode{}, logRow.EntityID).Error; err != nil {
					return err
				}
			} else {
				if isNullJSONB(logRow.BeforeJSON) {
					return errors.New("ไม่มีข้อมูลก่อนแก้ไขสำหรับย้อนกลับ")
				}
				var before models.MapNode
				if err := json.Unmarshal(logRow.BeforeJSON, &before); err != nil {
					return fmt.Errorf("ข้อมูลก่อนแก้ไขไม่ถูกต้อง: %w", err)
				}
				beforeImgJSON := string(before.ImageURLs)
				if strings.TrimSpace(beforeImgJSON) == "" || strings.TrimSpace(beforeImgJSON) == "null" {
					beforeImgJSON = "[]"
				}
				if isDelete {
					if err := tx.Exec(`
						INSERT INTO map_nodes (id, version_id, name, is_building, building_code, badge_label, floor_range, service_status, category_id, keywords, indoor_guide, image_url, image_urls, lat, lng, geom)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))
						ON CONFLICT (id) DO UPDATE SET
							name = EXCLUDED.name,
							is_building = EXCLUDED.is_building,
							building_code = EXCLUDED.building_code,
							badge_label = EXCLUDED.badge_label,
							floor_range = EXCLUDED.floor_range,
							service_status = EXCLUDED.service_status,
							category_id = EXCLUDED.category_id,
							keywords = EXCLUDED.keywords,
							indoor_guide = EXCLUDED.indoor_guide,
							image_url = EXCLUDED.image_url,
							image_urls = EXCLUDED.image_urls,
							lat = EXCLUDED.lat,
							lng = EXCLUDED.lng,
							geom = EXCLUDED.geom
					`,
						before.ID, before.VersionID, before.Name, before.IsBuilding,
						before.BuildingCode, before.BadgeLabel, before.FloorRange, before.ServiceStatus, before.CategoryID,
						before.Keywords, before.IndoorGuide, before.ImageURL, beforeImgJSON, before.Lat, before.Lng, before.Lng, before.Lat,
					).Error; err != nil {
						return err
					}
				} else {
					res := tx.Exec(`
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
					`,
						before.Name, before.IsBuilding,
						before.BuildingCode, before.BadgeLabel, before.FloorRange, before.ServiceStatus, before.CategoryID,
						before.Keywords, before.IndoorGuide, before.ImageURL, beforeImgJSON, before.Lat, before.Lng, before.Lng, before.Lat,
						logRow.EntityID,
					)
					if res.Error != nil {
						return res.Error
					}
					if res.RowsAffected == 0 {
						return errors.New("ไม่พบอาคาร/จุดพิกัดเดิมในฐานข้อมูลแล้ว")
					}
				}

				// Keep connected edges' geometry and distance in sync
				if err := tx.Exec(`
					UPDATE map_edges AS e
					SET distance_m = ST_Distance(a.geom::geography, b.geom::geography),
					    geom = ST_MakeLine(a.geom, b.geom)
					FROM map_nodes AS a, map_nodes AS b
					WHERE e.from_node = a.id
					  AND e.to_node = b.id
					  AND (e.from_node = ? OR e.to_node = ?)
				`, logRow.EntityID, logRow.EntityID).Error; err != nil {
					return err
				}
			}

		case "edge":
			if isCreate {
				if err := tx.Delete(&models.MapEdge{}, logRow.EntityID).Error; err != nil {
					return err
				}
			} else {
				if isNullJSONB(logRow.BeforeJSON) {
					return errors.New("ไม่มีข้อมูลเส้นทางก่อนแก้ไขสำหรับย้อนกลับ")
				}
				var before models.MapEdge
				if err := json.Unmarshal(logRow.BeforeJSON, &before); err != nil {
					return fmt.Errorf("ข้อมูลเส้นทางก่อนแก้ไขไม่ถูกต้อง: %w", err)
				}
				if isDelete {
					res := tx.Exec(`
						INSERT INTO map_edges (
							id, version_id, from_node, to_node, distance_m, instruction,
							is_wheelchair_friendly, is_active, is_covered, is_indoor_passthrough, closure_reason, geom
						)
						SELECT
							?, a.version_id, a.id, b.id,
							ST_Distance(a.geom::geography, b.geom::geography),
							?, ?, ?, ?, ?, ?,
							ST_MakeLine(a.geom, b.geom)
						FROM map_nodes AS a, map_nodes AS b
						WHERE a.id = ? AND b.id = ?
						ON CONFLICT (id) DO NOTHING
					`,
						before.ID,
						before.Instruction, before.IsWheelchairFriendly, before.IsActive,
						before.IsCovered, before.IsIndoorPassthrough, before.ClosureReason,
						before.FromNode, before.ToNode,
					)
					if res.Error != nil {
						return res.Error
					}
					if res.RowsAffected == 0 {
						return errors.New("ไม่สามารถคืนค่าเส้นทางได้เนื่องจากจุดต้นทางหรือปลายทางถูกลบไปแล้ว")
					}
				} else {
					res := tx.Exec(`
						UPDATE map_edges
						SET instruction = ?,
						    is_wheelchair_friendly = ?,
						    is_active = ?,
						    is_covered = ?,
						    is_indoor_passthrough = ?,
						    closure_reason = ?
						WHERE id = ?
					`,
						before.Instruction, before.IsWheelchairFriendly, before.IsActive,
						before.IsCovered, before.IsIndoorPassthrough, before.ClosureReason,
						logRow.EntityID,
					)
					if res.Error != nil {
						return res.Error
					}
					if res.RowsAffected == 0 {
						return errors.New("ไม่พบเส้นทางเดิมในฐานข้อมูลแล้ว")
					}
				}
			}

		case "department":
			if isCreate {
				if err := tx.Delete(&models.Department{}, logRow.EntityID).Error; err != nil {
					return err
				}
			} else {
				if isNullJSONB(logRow.BeforeJSON) {
					return errors.New("ไม่มีข้อมูลแผนกก่อนแก้ไขสำหรับย้อนกลับ")
				}
				var before models.Department
				if err := json.Unmarshal(logRow.BeforeJSON, &before); err != nil {
					return fmt.Errorf("ข้อมูลแผนกก่อนแก้ไขไม่ถูกต้อง: %w", err)
				}
				if isDelete {
					if err := tx.Create(&before).Error; err != nil {
						return err
					}
				} else {
					if err := tx.Model(&models.Department{}).Where("id = ?", logRow.EntityID).Updates(map[string]any{
						"node_id":         before.NodeID,
						"name":            before.Name,
						"floor":           before.Floor,
						"operating_hours": before.OperatingHours,
						"phone":           before.Phone,
						"keywords":        before.Keywords,
					}).Error; err != nil {
						return err
					}
				}
			}

		case "category":
			if isCreate {
				_ = tx.Model(&models.MapNode{}).Where("category_id = ?", logRow.EntityID).Update("category_id", nil).Error
				if err := tx.Delete(&models.Category{}, logRow.EntityID).Error; err != nil {
					return err
				}
			} else {
				if isNullJSONB(logRow.BeforeJSON) {
					return errors.New("ไม่มีข้อมูลหมวดหมู่ก่อนแก้ไขสำหรับย้อนกลับ")
				}
				var before models.Category
				if err := json.Unmarshal(logRow.BeforeJSON, &before); err != nil {
					return fmt.Errorf("ข้อมูลหมวดหมู่ก่อนแก้ไขไม่ถูกต้อง: %w", err)
				}
				if isDelete {
					if err := tx.Create(&before).Error; err != nil {
						return err
					}
				} else {
					if err := tx.Model(&models.Category{}).Where("id = ?", logRow.EntityID).Updates(map[string]any{
						"name":           before.Name,
						"slug":           before.Slug,
						"color_hex":      before.ColorHex,
						"badge_bg":       before.BadgeBg,
						"sort_order":     before.SortOrder,
						"show_in_legend": before.ShowInLegend,
					}).Error; err != nil {
						return err
					}
				}
			}

		default:
			return errors.New("ประเภทข้อมูลนี้ยังไม่รองรับการย้อนกลับอัตโนมัติ")
		}

		// Mark original log as rolled back
		if err := tx.Model(&models.AuditLog{}).Where("id = ?", logRow.ID).Update("is_rolled_back", true).Error; err != nil {
			return err
		}

		// Record the rollback event itself
		rbEntry := models.AuditLog{
			ActionType:  "rollback",
			ActionLabel: "ย้อนกลับค่าเดิม",
			EntityType:  logRow.EntityType,
			EntityID:    logRow.EntityID,
			BadgeText:   logRow.BadgeText,
			TargetTitle: logRow.TargetTitle,
			Summary:     fmt.Sprintf("ย้อนกลับรายการ \"%s\" (#%d)", logRow.ActionLabel, logRow.ID),
			ActorName:   resolveActorName(c),
			BeforeJSON:  logRow.AfterJSON,
			AfterJSON:   logRow.BeforeJSON,
		}
		if err := tx.Create(&rbEntry).Error; err != nil {
			return err
		}

		return nil
	})

	if txErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": txErr.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "ย้อนกลับค่าเดิมเรียบร้อยแล้ว",
		"id":      logRow.ID,
	})
}
