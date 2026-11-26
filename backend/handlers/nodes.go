package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

type nodeRequest struct {
	Name        string   `json:"name"`
	IsBuilding  bool     `json:"is_building"`
	Keywords    string   `json:"keywords"`
	IndoorGuide string   `json:"indoor_guide"`
	ImageURL    string   `json:"image_url"`
	Lat         *float64 `json:"lat" binding:"required"`
	Lng         *float64 `json:"lng" binding:"required"`
}

func validateCoordinates(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// SearchBuildings returns public building nodes (is_building = true) filtered by optional query `q`.
func SearchBuildings(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))

	query := config.DB.Model(&models.MapNode{}).Where("is_building = ?", true)
	if q != "" {
		pattern := "%" + q + "%"
		query = query.Where(
			"name ILIKE ? OR COALESCE(keywords, '') ILIKE ? OR COALESCE(indoor_guide, '') ILIKE ?",
			pattern, pattern, pattern,
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

// GetAllNodes returns all map nodes (both buildings and road intersections) for admin management.
func GetAllNodes(c *gin.Context) {
	nodes := make([]models.MapNode, 0)
	if err := config.DB.Order("id ASC").Find(&nodes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch map nodes",
		})
		return
	}

	c.JSON(http.StatusOK, nodes)
}

// CreateNode creates a new map node and automatically computes PostGIS geom using ST_MakePoint(lng, lat).
func CreateNode(c *gin.Context) {
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

	var created models.MapNode
	err := config.DB.Raw(`
		INSERT INTO map_nodes (name, is_building, keywords, indoor_guide, image_url, lat, lng, geom)
		VALUES (?, ?, ?, ?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326))
		RETURNING id, name, is_building, keywords, indoor_guide, image_url, lat, lng, created_at
	`,
		strings.TrimSpace(req.Name),
		req.IsBuilding,
		strings.TrimSpace(req.Keywords),
		strings.TrimSpace(req.IndoorGuide),
		strings.TrimSpace(req.ImageURL),
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

	var updated models.MapNode
	err = config.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Raw(`
			UPDATE map_nodes
			SET name = ?,
			    is_building = ?,
			    keywords = ?,
			    indoor_guide = ?,
			    image_url = ?,
			    lat = ?,
			    lng = ?,
			    geom = ST_SetSRID(ST_MakePoint(?, ?), 4326)
			WHERE id = ?
			RETURNING id, name, is_building, keywords, indoor_guide, image_url, lat, lng, created_at
		`,
			strings.TrimSpace(req.Name),
			req.IsBuilding,
			strings.TrimSpace(req.Keywords),
			strings.TrimSpace(req.IndoorGuide),
			strings.TrimSpace(req.ImageURL),
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

	c.JSON(http.StatusOK, updated)
}

// DeleteNode deletes a node and any edges attached to it inside a transaction.
func DeleteNode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid node ID",
		})
		return
	}

	err = config.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("from_node = ? OR to_node = ?", id, id).Delete(&models.MapEdge{}).Error; err != nil {
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

	c.JSON(http.StatusOK, gin.H{
		"message": "Node deleted successfully",
		"id":      id,
	})
}
