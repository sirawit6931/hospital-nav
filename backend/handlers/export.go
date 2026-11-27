package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

// ExportAllBackup returns a complete JSON backup of all hospital navigation tables + 3D overrides.
func ExportAllBackup(c *gin.Context) {
	versions := make([]models.MapVersion, 0)
	nodes := make([]models.MapNode, 0)
	edges := make([]models.MapEdge, 0)
	categories := make([]models.Category, 0)
	departments := make([]models.Department, 0)
	servicePoints := make([]models.ServicePoint, 0)
	announcements := make([]models.Announcement, 0)
	surveyTracks := make([]models.SurveyTrack, 0)

	if err := config.DB.Order("id ASC").Find(&versions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล map_versions ได้"})
		return
	}

	if err := config.DB.Order("id ASC").Find(&nodes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล map_nodes ได้"})
		return
	}
	if err := config.DB.Order("id ASC").Find(&edges).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล map_edges ได้"})
		return
	}
	if err := config.DB.Order("sort_order ASC, id ASC").Find(&categories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล categories ได้"})
		return
	}
	if err := config.DB.Order("id ASC").Find(&departments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล departments ได้"})
		return
	}
	if err := config.DB.Order("id ASC").Find(&servicePoints).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล service_points ได้"})
		return
	}
	if err := config.DB.Order("id ASC").Find(&announcements).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล announcements ได้"})
		return
	}
	if err := config.DB.Order("id ASC").Find(&surveyTracks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถส่งออกข้อมูล survey_tracks ได้"})
		return
	}

	map3D := defaultMap3DPayload()
	map3DMu.RLock()
	if raw, err := os.ReadFile(map3DOverridesFile); err == nil {
		_ = json.Unmarshal(raw, &map3D)
	}
	map3DMu.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"exported_at":      time.Now().Format(time.RFC3339),
		"hospital":         "โรงพยาบาลสกลนคร (Sakon Nakhon Hospital)",
		"map_versions":     versions,
		"map_nodes":        nodes,
		"map_edges":        edges,
		"categories":       categories,
		"departments":      departments,
		"service_points":   servicePoints,
		"announcements":    announcements,
		"survey_tracks":    surveyTracks,
		"map_3d_overrides": map3D,
	})
}
