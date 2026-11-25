package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

type createSurveyRequest struct {
	Name       string       `json:"name" binding:"required"`
	PointsJSON models.JSONB `json:"points_json" binding:"required"`
}

// GetSurveys returns all recorded mobile GPS survey tracks.
func GetSurveys(c *gin.Context) {
	surveys := make([]models.SurveyTrack, 0)
	if err := config.DB.Order("created_at DESC, id DESC").Find(&surveys).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch survey tracks",
		})
		return
	}

	c.JSON(http.StatusOK, surveys)
}

// CreateSurvey saves a new mobile GPS survey track (points_json).
func CreateSurvey(c *gin.Context) {
	var req createSurveyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid survey payload (name and points_json are required)",
		})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Survey name cannot be empty",
		})
		return
	}

	if len(req.PointsJSON) == 0 || !json.Valid(req.PointsJSON) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "points_json must be valid JSON",
		})
		return
	}

	track := models.SurveyTrack{
		Name:       name,
		PointsJSON: req.PointsJSON,
	}

	if err := config.DB.Create(&track).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to save survey track",
		})
		return
	}

	c.JSON(http.StatusCreated, track)
}

// DeleteSurvey deletes a survey track by ID.
func DeleteSurvey(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid survey track ID",
		})
		return
	}

	result := config.DB.Delete(&models.SurveyTrack{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete survey track",
		})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Survey track not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Survey track deleted successfully",
		"id":      id,
	})
}
