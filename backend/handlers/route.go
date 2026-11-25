package handlers

import (
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
	"hospital-nav-backend/services"
)

const walkingSpeedMetersPerMin = 80.0

// GetRoute calculates the shortest walking route from the user's current GPS position to target_node_id.
// Query params: lat, lng, target_node_id
func GetRoute(c *gin.Context) {
	latStr := c.Query("lat")
	lngStr := c.Query("lng")
	targetIDStr := c.Query("target_node_id")

	if latStr == "" || lngStr == "" || targetIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Query parameters lat, lng, and target_node_id are required",
		})
		return
	}

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

	targetNodeID64, err := strconv.ParseUint(targetIDStr, 10, 64)
	if err != nil || targetNodeID64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid target_node_id parameter",
		})
		return
	}
	targetNodeID := uint(targetNodeID64)

	// 1. Fetch the target building/node.
	var targetNode models.MapNode
	if err := config.DB.First(&targetNode, targetNodeID).Error; err != nil {
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

	// 2. Find the nearest map node to the user's GPS coordinate using PostGIS <-> operator.
	var nearestNode models.MapNode
	nearestResult := config.DB.Raw(`
		SELECT id, name, is_building, keywords, indoor_guide, image_url, lat, lng, created_at
		FROM map_nodes
		ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)
		LIMIT 1
	`, lng, lat).Scan(&nearestNode)
	if nearestResult.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to find nearest starting node",
		})
		return
	}
	if nearestResult.RowsAffected == 0 || nearestNode.ID == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "ยังไม่มีข้อมูลจุดนำทางในแผนที่",
		})
		return
	}

	// 3. Load all active edges (is_active = true) to build an undirected walking graph.
	var activeEdges []models.MapEdge
	if err := config.DB.Where("is_active = ?", true).Find(&activeEdges).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to load active map edges",
		})
		return
	}

	// 4. Compute shortest path via Dijkstra.
	nodeIDs, totalDistance, found := services.FindShortestPath(activeEdges, nearestNode.ID, targetNode.ID)
	if !found || len(nodeIDs) == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "ไม่สามารถค้นหาเส้นทางไปยังปลายทางได้ เนื่องจากยังไม่มีเส้นทางเชื่อมถึงหรือเส้นทางปิดปรับปรุงชั่วคราว",
		})
		return
	}

	// 5. Fetch node coordinates for all nodes in the path.
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
		"path":               pathCoords,
		"total_distance_m":   roundedDistance,
		"estimated_walk_min": estimatedWalkMin,
		"target_building":    targetNode,
	})
}
