package handlers

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

type createEdgeRequest struct {
	FromNode             uint   `json:"from_node" binding:"required"`
	ToNode               uint   `json:"to_node" binding:"required"`
	Instruction          string `json:"instruction"`
	IsWheelchairFriendly *bool  `json:"is_wheelchair_friendly"`
}

type patchEdgeActiveRequest struct {
	IsActive *bool `json:"is_active"`
}

// GetAllEdges returns all map edges for admin management.
func GetAllEdges(c *gin.Context) {
	edges := make([]models.MapEdge, 0)
	if err := config.DB.Order("id ASC").Find(&edges).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch map edges",
		})
		return
	}

	c.JSON(http.StatusOK, edges)
}

// CreateEdge creates a new map edge and calculates distance_m and LineString geom via PostGIS.
func CreateEdge(c *gin.Context) {
	var req createEdgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid edge payload (from_node and to_node are required)",
		})
		return
	}

	if req.FromNode == req.ToNode {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "from_node and to_node must be different nodes",
		})
		return
	}

	wheelchairFriendly := true
	if req.IsWheelchairFriendly != nil {
		wheelchairFriendly = *req.IsWheelchairFriendly
	}

	var created models.MapEdge
	result := config.DB.Raw(`
		INSERT INTO map_edges (from_node, to_node, distance_m, instruction, is_wheelchair_friendly, is_active, geom)
		SELECT
			a.id,
			b.id,
			ST_Distance(a.geom::geography, b.geom::geography),
			?,
			?,
			true,
			ST_MakeLine(a.geom, b.geom)
		FROM map_nodes AS a, map_nodes AS b
		WHERE a.id = ? AND b.id = ?
		RETURNING id, from_node, to_node, distance_m, instruction, is_wheelchair_friendly, is_active
	`,
		strings.TrimSpace(req.Instruction),
		wheelchairFriendly,
		req.FromNode,
		req.ToNode,
	).Scan(&created)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create map edge",
		})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "One or both specified nodes (from_node, to_node) were not found",
		})
		return
	}

	c.JSON(http.StatusCreated, created)
}

// ToggleEdgeActive toggles is_active (or sets it explicitly if provided in JSON body) for temporary path closures.
func ToggleEdgeActive(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid edge ID",
		})
		return
	}

	var req patchEdgeActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid JSON body",
		})
		return
	}

	var updated models.MapEdge
	var resultErr error
	var rowsAffected int64

	if req.IsActive != nil {
		res := config.DB.Raw(`
			UPDATE map_edges
			SET is_active = ?
			WHERE id = ?
			RETURNING id, from_node, to_node, distance_m, instruction, is_wheelchair_friendly, is_active
		`, *req.IsActive, id).Scan(&updated)
		resultErr = res.Error
		rowsAffected = res.RowsAffected
	} else {
		res := config.DB.Raw(`
			UPDATE map_edges
			SET is_active = NOT COALESCE(is_active, true)
			WHERE id = ?
			RETURNING id, from_node, to_node, distance_m, instruction, is_wheelchair_friendly, is_active
		`, id).Scan(&updated)
		resultErr = res.Error
		rowsAffected = res.RowsAffected
	}

	if resultErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update edge status",
		})
		return
	}
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Edge not found",
		})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// DeleteEdge removes a map edge by ID.
func DeleteEdge(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid edge ID",
		})
		return
	}

	result := config.DB.Delete(&models.MapEdge{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete map edge",
		})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Edge not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Edge deleted successfully",
		"id":      id,
	})
}
