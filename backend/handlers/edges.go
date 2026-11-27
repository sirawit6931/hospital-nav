package handlers

import (
	"errors"
	"fmt"
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
	IsCovered            *bool  `json:"is_covered"`
	IsIndoorPassthrough  *bool  `json:"is_indoor_passthrough"`
	ClosureReason        string `json:"closure_reason"`
}

type updateEdgeRequest struct {
	Instruction          *string `json:"instruction"`
	IsWheelchairFriendly *bool   `json:"is_wheelchair_friendly"`
	IsActive             *bool   `json:"is_active"`
	IsCovered            *bool   `json:"is_covered"`
	IsIndoorPassthrough  *bool   `json:"is_indoor_passthrough"`
	ClosureReason        *string `json:"closure_reason"`
}

// GetAllEdges returns map edges for admin management, scoped to ?version_id=... (defaults to Live version).
func GetAllEdges(c *gin.Context) {
	versionID, err := ResolveRequestedVersionID(c, "version_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	edges := make([]models.MapEdge, 0)
	if err := config.DB.Where("version_id = ?", versionID).Order("id ASC").Find(&edges).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch map edges",
		})
		return
	}

	c.JSON(http.StatusOK, edges)
}

// CreateEdge creates a new map edge and calculates distance_m and LineString geom via PostGIS.
// Enforces that both endpoints belong to the same map version.
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
	isCovered := false
	if req.IsCovered != nil {
		isCovered = *req.IsCovered
	}
	isIndoor := false
	if req.IsIndoorPassthrough != nil {
		isIndoor = *req.IsIndoorPassthrough
	}

	var created models.MapEdge
	result := config.DB.Raw(`
		INSERT INTO map_edges (
			version_id, from_node, to_node, distance_m, instruction,
			is_wheelchair_friendly, is_active, is_covered, is_indoor_passthrough, closure_reason, geom
		)
		SELECT
			a.version_id,
			a.id,
			b.id,
			ST_Distance(a.geom::geography, b.geom::geography),
			?,
			?,
			true,
			?,
			?,
			?,
			ST_MakeLine(a.geom, b.geom)
		FROM map_nodes AS a, map_nodes AS b
		WHERE a.id = ? AND b.id = ? AND a.version_id = b.version_id
		RETURNING id, version_id, from_node, to_node, distance_m, instruction,
		          is_wheelchair_friendly, is_active, is_covered, is_indoor_passthrough, closure_reason
	`,
		strings.TrimSpace(req.Instruction),
		wheelchairFriendly,
		isCovered,
		isIndoor,
		strings.TrimSpace(req.ClosureReason),
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

	RecordAuditLog(c, AuditEntry{
		ActionType:  "edge_create",
		ActionLabel: "อัปเดตแผนที่ 3D",
		EntityType:  "edge",
		EntityID:    created.ID,
		BadgeText:   "MAP 3D",
		TargetTitle: fmt.Sprintf("เส้นทางเชื่อมจุด #%d → #%d", created.FromNode, created.ToNode),
		Summary:     fmt.Sprintf("เพิ่มเส้นทางเดินใหม่ระยะ %.0f ม.", created.DistanceM),
		Before:      nil,
		After:       created,
	})

	c.JSON(http.StatusCreated, created)
}

// UpdateEdge updates edge attributes (instruction, wheelchair, active, covered, indoor passthrough, closure reason).
func UpdateEdge(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid edge ID"})
		return
	}

	var req updateEdgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid edge update payload"})
		return
	}

	var existing models.MapEdge
	if err := config.DB.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Edge not found"})
		return
	}
	beforeSnap := existing

	if req.Instruction != nil {
		existing.Instruction = strings.TrimSpace(*req.Instruction)
	}
	if req.IsWheelchairFriendly != nil {
		existing.IsWheelchairFriendly = *req.IsWheelchairFriendly
	}
	if req.IsActive != nil {
		existing.IsActive = *req.IsActive
	}
	if req.IsCovered != nil {
		existing.IsCovered = *req.IsCovered
	}
	if req.IsIndoorPassthrough != nil {
		existing.IsIndoorPassthrough = *req.IsIndoorPassthrough
	}
	if req.ClosureReason != nil {
		existing.ClosureReason = strings.TrimSpace(*req.ClosureReason)
	}
	// Clear closure reason automatically if re-opened and no reason explicitly set
	if existing.IsActive && req.ClosureReason == nil {
		existing.ClosureReason = ""
	}

	var updated models.MapEdge
	res := config.DB.Raw(`
		UPDATE map_edges
		SET instruction = ?,
		    is_wheelchair_friendly = ?,
		    is_active = ?,
		    is_covered = ?,
		    is_indoor_passthrough = ?,
		    closure_reason = ?
		WHERE id = ?
		RETURNING id, from_node, to_node, distance_m, instruction,
		          is_wheelchair_friendly, is_active, is_covered, is_indoor_passthrough, closure_reason
	`,
		existing.Instruction,
		existing.IsWheelchairFriendly,
		existing.IsActive,
		existing.IsCovered,
		existing.IsIndoorPassthrough,
		existing.ClosureReason,
		id,
	).Scan(&updated)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update map edge"})
		return
	}

	RecordAuditLog(c, AuditEntry{
		ActionType:  "edge_update",
		ActionLabel: "อัปเดตแผนที่ 3D",
		EntityType:  "edge",
		EntityID:    updated.ID,
		BadgeText:   "MAP 3D",
		TargetTitle: fmt.Sprintf("เส้นทาง #%d (จุด #%d → #%d)", updated.ID, updated.FromNode, updated.ToNode),
		Summary:     fmt.Sprintf("อัปเดตคุณสมบัติเส้นทาง (สถานะ: %s)", map[bool]string{true: "เปิดใช้งาน", false: "ปิดชั่วคราว"}[updated.IsActive]),
		Before:      beforeSnap,
		After:       updated,
	})

	c.JSON(http.StatusOK, updated)
}

// ToggleEdgeActive toggles is_active (or sets fields explicitly if provided in JSON body) for temporary path closures.
func ToggleEdgeActive(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid edge ID",
		})
		return
	}

	var req updateEdgeRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid JSON body",
		})
		return
	}

	var existing models.MapEdge
	if err := config.DB.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Edge not found"})
		return
	}
	beforeSnap := existing

	nextActive := !existing.IsActive
	if req.IsActive != nil {
		nextActive = *req.IsActive
	}
	nextCovered := existing.IsCovered
	if req.IsCovered != nil {
		nextCovered = *req.IsCovered
	}
	nextIndoor := existing.IsIndoorPassthrough
	if req.IsIndoorPassthrough != nil {
		nextIndoor = *req.IsIndoorPassthrough
	}
	nextReason := existing.ClosureReason
	if req.ClosureReason != nil {
		nextReason = strings.TrimSpace(*req.ClosureReason)
	} else if nextActive {
		nextReason = ""
	}

	var updated models.MapEdge
	res := config.DB.Raw(`
		UPDATE map_edges
		SET is_active = ?,
		    is_covered = ?,
		    is_indoor_passthrough = ?,
		    closure_reason = ?
		WHERE id = ?
		RETURNING id, from_node, to_node, distance_m, instruction,
		          is_wheelchair_friendly, is_active, is_covered, is_indoor_passthrough, closure_reason
	`, nextActive, nextCovered, nextIndoor, nextReason, id).Scan(&updated)

	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update edge status",
		})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Edge not found",
		})
		return
	}

	RecordAuditLog(c, AuditEntry{
		ActionType:  "edge_update",
		ActionLabel: "อัปเดตแผนที่ 3D",
		EntityType:  "edge",
		EntityID:    updated.ID,
		BadgeText:   "MAP 3D",
		TargetTitle: fmt.Sprintf("เส้นทาง #%d (จุด #%d → #%d)", updated.ID, updated.FromNode, updated.ToNode),
		Summary:     map[bool]string{true: "เปิดใช้งานเส้นทางเดิน", false: "ปิดเส้นทางชั่วคราว"}[updated.IsActive],
		Before:      beforeSnap,
		After:       updated,
	})

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

	var before models.MapEdge
	if err := config.DB.First(&before, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Edge not found",
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

	RecordAuditLog(c, AuditEntry{
		ActionType:  "edge_delete",
		ActionLabel: "อัปเดตแผนที่ 3D",
		EntityType:  "edge",
		EntityID:    before.ID,
		BadgeText:   "MAP 3D",
		TargetTitle: fmt.Sprintf("เส้นทาง #%d (จุด #%d → #%d)", before.ID, before.FromNode, before.ToNode),
		Summary:     "ลบเส้นทางเชื่อมต่อออกจากแผนที่ 3D",
		Before:      before,
		After:       nil,
	})

	c.JSON(http.StatusOK, gin.H{
		"message": "Edge deleted successfully",
		"id":      id,
	})
}
