package handlers

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
	"hospital-nav-backend/services"
)

const walkingSpeedMetersPerMin = 80.0

type RouteEdgeSummary struct {
	ID                   uint    `json:"id"`
	FromNode             uint    `json:"from_node"`
	ToNode               uint    `json:"to_node"`
	DistanceM            float64 `json:"distance_m"`
	Instruction          string  `json:"instruction"`
	IsWheelchairFriendly bool    `json:"is_wheelchair_friendly"`
	IsCovered            bool    `json:"is_covered"`
	IsIndoorPassthrough  bool    `json:"is_indoor_passthrough"`
}

type ClosedEdgeNotice struct {
	ID            uint   `json:"id"`
	FromNode      uint   `json:"from_node"`
	ToNode        uint   `json:"to_node"`
	ClosureReason string `json:"closure_reason"`
}

func makeUndirectedEdgeKey(a, b uint) [2]uint {
	if a < b {
		return [2]uint{a, b}
	}
	return [2]uint{b, a}
}

// GetRoute calculates the shortest walking route from the user's current GPS position
// (or an explicit start_node_id from a QR code) to target_node_id.
// Query params: target_node_id, and either start_node_id or (lat, lng)
func GetRoute(c *gin.Context) {
	latStr := c.Query("lat")
	lngStr := c.Query("lng")
	startIDStr := c.Query("start_node_id")
	targetIDStr := c.Query("target_node_id")

	if targetIDStr == "" || (startIDStr == "" && (latStr == "" || lngStr == "")) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Query parameter target_node_id and either start_node_id or (lat, lng) are required",
		})
		return
	}

	targetNodeID64, err := strconv.ParseUint(targetIDStr, 10, 64)
	if err != nil || targetNodeID64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid target_node_id parameter",
		})
		return
	}
	targetNodeID := uint(targetNodeID64)

	// 0. Resolve active Live version (or admin ?preview_version_id=ID).
	versionID, verErr := ResolveRequestedVersionID(c, "preview_version_id", "version_id")
	if verErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": verErr.Error(),
		})
		return
	}

	// 1. Fetch the target building/node with its departments within the resolved version.
	var targetNode models.MapNode
	if err := config.DB.Preload("Departments", func(db *gorm.DB) *gorm.DB {
		return db.Order("floor ASC, name ASC")
	}).Where("id = ? AND version_id = ?", targetNodeID, versionID).First(&targetNode).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "ไม่พบอาคารหรือจุดปลายทางที่ระบุในระบบ",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch target building",
		})
		return
	}

	// 2. Resolve starting node: explicit start_node_id (e.g. from QR code) or nearest node via PostGIS.
	var startNode models.MapNode
	if startIDStr != "" {
		startID64, err := strconv.ParseUint(startIDStr, 10, 64)
		if err != nil || startID64 == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid start_node_id parameter",
			})
			return
		}
		if err := config.DB.Where("id = ? AND version_id = ?", uint(startID64), versionID).First(&startNode).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{
					"error": "ไม่พบจุดเริ่มต้นที่ระบุในระบบ",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to fetch starting node",
			})
			return
		}
	} else {
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil || math.IsNaN(lat) || math.IsInf(lat, 0) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid lat parameter",
			})
			return
		}

		lng, err := strconv.ParseFloat(lngStr, 64)
		if err != nil || math.IsNaN(lng) || math.IsInf(lng, 0) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid lng parameter",
			})
			return
		}

		if !validateCoordinates(lat, lng) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Coordinates out of range: lat must be [-90, 90] and lng must be [-180, 180]",
			})
			return
		}

		nearestResult := config.DB.Raw(`
			SELECT id, version_id, name, is_building, keywords, indoor_guide, image_url, lat, lng, created_at
			FROM map_nodes
			WHERE version_id = ?
			ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)
			LIMIT 1
		`, versionID, lng, lat).Scan(&startNode)
		if nearestResult.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to find nearest starting node",
			})
			return
		}
		if nearestResult.RowsAffected == 0 || startNode.ID == 0 {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "ยังไม่มีข้อมูลจุดนำทางในแผนที่",
			})
			return
		}
	}

	// 3. Load all edges of this version so we can route on active ones and surface closure_reason notices for closed ones.
	var allEdges []models.MapEdge
	if err := config.DB.Where("version_id = ?", versionID).Find(&allEdges).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to load map edges",
		})
		return
	}

	activeEdges := make([]models.MapEdge, 0, len(allEdges))
	closedNotices := make([]ClosedEdgeNotice, 0)
	for _, edge := range allEdges {
		if edge.IsActive {
			activeEdges = append(activeEdges, edge)
		} else if reason := strings.TrimSpace(edge.ClosureReason); reason != "" {
			closedNotices = append(closedNotices, ClosedEdgeNotice{
				ID:            edge.ID,
				FromNode:      edge.FromNode,
				ToNode:        edge.ToNode,
				ClosureReason: reason,
			})
		}
	}

	// 4. Compute shortest path via Dijkstra on active edges.
	nodeIDs, totalDistance, found := services.FindShortestPath(activeEdges, startNode.ID, targetNode.ID)
	if !found || len(nodeIDs) == 0 {
		errMsg := "ไม่สามารถค้นหาเส้นทางไปยังปลายทางได้ เนื่องจากยังไม่มีเส้นทางเชื่อมถึงหรือเส้นทางปิดปรับปรุงชั่วคราว"
		if len(closedNotices) > 0 {
			reasons := make([]string, 0, len(closedNotices))
			seen := make(map[string]bool)
			for _, n := range closedNotices {
				if !seen[n.ClosureReason] {
					seen[n.ClosureReason] = true
					reasons = append(reasons, n.ClosureReason)
				}
			}
			errMsg = errMsg + " (" + strings.Join(reasons, ", ") + ")"
		}
		c.JSON(http.StatusNotFound, gin.H{
			"error":          errMsg,
			"closed_notices": closedNotices,
		})
		return
	}

	// 5. Collect traversed edge metadata (covered walkways, indoor passthrough, wheelchair accessibility).
	edgeByPair := make(map[[2]uint]models.MapEdge, len(activeEdges))
	for _, edge := range activeEdges {
		key := makeUndirectedEdgeKey(edge.FromNode, edge.ToNode)
		if existing, exists := edgeByPair[key]; !exists || edge.DistanceM < existing.DistanceM {
			edgeByPair[key] = edge
		}
	}

	routeEdges := make([]RouteEdgeSummary, 0, max(0, len(nodeIDs)-1))
	isWheelchairFriendly := true
	hasCoveredWalkway := false
	hasIndoorPassthrough := false

	for i := 0; i < len(nodeIDs)-1; i++ {
		u := nodeIDs[i]
		v := nodeIDs[i+1]
		if edge, ok := edgeByPair[makeUndirectedEdgeKey(u, v)]; ok {
			if !edge.IsWheelchairFriendly {
				isWheelchairFriendly = false
			}
			if edge.IsCovered {
				hasCoveredWalkway = true
			}
			if edge.IsIndoorPassthrough {
				hasIndoorPassthrough = true
			}
			routeEdges = append(routeEdges, RouteEdgeSummary{
				ID:                   edge.ID,
				FromNode:             u,
				ToNode:               v,
				DistanceM:            math.Round(edge.DistanceM*100) / 100,
				Instruction:          edge.Instruction,
				IsWheelchairFriendly: edge.IsWheelchairFriendly,
				IsCovered:            edge.IsCovered,
				IsIndoorPassthrough:  edge.IsIndoorPassthrough,
			})
		}
	}

	// 6. Fetch node coordinates for all nodes in the path.
	var pathNodes []models.MapNode
	if err := config.DB.Where("id IN ?", nodeIDs).Find(&pathNodes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to resolve route node coordinates",
		})
		return
	}

	nodeLookup := make(map[uint]models.MapNode, len(pathNodes))
	for _, n := range pathNodes {
		nodeLookup[n.ID] = n
	}

	pathCoords := make([][2]float64, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		node, ok := nodeLookup[id]
		if !ok {
			continue
		}
		pathCoords = append(pathCoords, [2]float64{node.Lat, node.Lng})
	}

	roundedDistance := math.Round(totalDistance*100) / 100
	estimatedWalkMin := math.Round((totalDistance/walkingSpeedMetersPerMin)*100) / 100

	c.JSON(http.StatusOK, gin.H{
		"path":                   pathCoords,
		"total_distance_m":       roundedDistance,
		"estimated_walk_min":     estimatedWalkMin,
		"target_building":        targetNode,
		"start_node":             startNode,
		"is_wheelchair_friendly": isWheelchairFriendly,
		"has_covered_walkway":    hasCoveredWalkway,
		"has_indoor_passthrough": hasIndoorPassthrough,
		"route_edges":            routeEdges,
		"closed_notices":         closedNotices,
	})
}
