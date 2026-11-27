package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

// ==================== CATEGORIES ====================

type categoryRequest struct {
	Name         string `json:"name" binding:"required"`
	Slug         string `json:"slug" binding:"required"`
	ColorHex     string `json:"color_hex"`
	BadgeBg      string `json:"badge_bg"`
	SortOrder    int    `json:"sort_order"`
	ShowInLegend *bool  `json:"show_in_legend"`
}

func GetPublicCategories(c *gin.Context) {
	items := make([]models.Category, 0)
	if err := config.DB.Order("sort_order ASC, id ASC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลหมวดหมู่ได้"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func GetAdminCategories(c *gin.Context) {
	GetPublicCategories(c)
}

func CreateCategory(c *gin.Context) {
	var req categoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณากรอกชื่อหมวดหมู่และ slug ให้ครบถ้วน"})
		return
	}

	showLegend := true
	if req.ShowInLegend != nil {
		showLegend = *req.ShowInLegend
	}
	colorHex := strings.TrimSpace(req.ColorHex)
	if colorHex == "" {
		colorHex = "#0F766E"
	}
	badgeBg := strings.TrimSpace(req.BadgeBg)
	if badgeBg == "" {
		badgeBg = "#CCFBF1"
	}

	item := models.Category{
		Name:         strings.TrimSpace(req.Name),
		Slug:         strings.ToLower(strings.TrimSpace(req.Slug)),
		ColorHex:     colorHex,
		BadgeBg:      badgeBg,
		SortOrder:    req.SortOrder,
		ShowInLegend: showLegend,
	}
	if err := config.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "ไม่สามารถสร้างหมวดหมู่ได้ (slug อาจซ้ำกัน)"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func UpdateCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสหมวดหมู่ไม่ถูกต้อง"})
		return
	}
	var req categoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ข้อมูลหมวดหมู่ไม่ถูกต้อง"})
		return
	}
	var item models.Category
	if err := config.DB.First(&item, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบหมวดหมู่ที่ต้องการแก้ไข"})
		return
	}

	item.Name = strings.TrimSpace(req.Name)
	item.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	if strings.TrimSpace(req.ColorHex) != "" {
		item.ColorHex = strings.TrimSpace(req.ColorHex)
	}
	if strings.TrimSpace(req.BadgeBg) != "" {
		item.BadgeBg = strings.TrimSpace(req.BadgeBg)
	}
	item.SortOrder = req.SortOrder
	if req.ShowInLegend != nil {
		item.ShowInLegend = *req.ShowInLegend
	}

	if err := config.DB.Save(&item).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "ไม่สามารถบันทึกหมวดหมู่ได้ (slug อาจซ้ำกัน)"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func DeleteCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสหมวดหมู่ไม่ถูกต้อง"})
		return
	}
	res := config.DB.Delete(&models.Category{}, id)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบหมวดหมู่ได้"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบหมวดหมู่ที่ต้องการลบ"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ลบหมวดหมู่เรียบร้อยแล้ว", "id": id})
}

// ==================== DEPARTMENTS ====================

type departmentRequest struct {
	NodeID         uint   `json:"node_id" binding:"required"`
	Name           string `json:"name" binding:"required"`
	Floor          string `json:"floor"`
	OperatingHours string `json:"operating_hours"`
	Phone          string `json:"phone"`
	Keywords       string `json:"keywords"`
}

func GetAdminDepartments(c *gin.Context) {
	items := make([]models.Department, 0)
	query := config.DB.Order("node_id ASC, floor ASC, name ASC, id ASC")
	if nodeIDStr := strings.TrimSpace(c.Query("node_id")); nodeIDStr != "" {
		if nodeID, err := strconv.ParseUint(nodeIDStr, 10, 64); err == nil && nodeID > 0 {
			query = query.Where("node_id = ?", nodeID)
		}
	}
	if err := query.Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลแผนกได้"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func CreateDepartment(c *gin.Context) {
	var req departmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาระบุอาคารและชื่อแผนกให้ครบถ้วน"})
		return
	}

	var count int64
	if err := config.DB.Model(&models.MapNode{}).Where("id = ?", req.NodeID).Count(&count).Error; err != nil || count == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบอาคาร (node_id) ที่เลือกในระบบ"})
		return
	}

	item := models.Department{
		NodeID:         req.NodeID,
		Name:           strings.TrimSpace(req.Name),
		Floor:          strings.TrimSpace(req.Floor),
		OperatingHours: strings.TrimSpace(req.OperatingHours),
		Phone:          strings.TrimSpace(req.Phone),
		Keywords:       strings.TrimSpace(req.Keywords),
	}
	if err := config.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถสร้างแผนกได้"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func UpdateDepartment(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสแผนกไม่ถูกต้อง"})
		return
	}
	var req departmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ข้อมูลแผนกไม่ถูกต้อง"})
		return
	}

	var nodeCount int64
	if err := config.DB.Model(&models.MapNode{}).Where("id = ?", req.NodeID).Count(&nodeCount).Error; err != nil || nodeCount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบอาคาร (node_id) ที่เลือกในระบบ"})
		return
	}

	var item models.Department
	if err := config.DB.First(&item, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบแผนกที่ต้องการแก้ไข"})
		return
	}

	item.NodeID = req.NodeID
	item.Name = strings.TrimSpace(req.Name)
	item.Floor = strings.TrimSpace(req.Floor)
	item.OperatingHours = strings.TrimSpace(req.OperatingHours)
	item.Phone = strings.TrimSpace(req.Phone)
	item.Keywords = strings.TrimSpace(req.Keywords)

	if err := config.DB.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกข้อมูลแผนกได้"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func DeleteDepartment(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสแผนกไม่ถูกต้อง"})
		return
	}
	res := config.DB.Delete(&models.Department{}, id)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบแผนกได้"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบแผนกที่ต้องการลบ"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ลบแผนกเรียบร้อยแล้ว", "id": id})
}

// ==================== SERVICE POINTS ====================

type servicePointRequest struct {
	NodeID      *uint  `json:"node_id"`
	Type        string `json:"type"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Phone       string `json:"phone"`
	IsActive    *bool  `json:"is_active"`
}

func GetPublicServicePoints(c *gin.Context) {
	items := make([]models.ServicePoint, 0)
	if err := config.DB.Where("is_active = ?", true).Order("id ASC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลจุดบริการได้"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func GetAdminServicePoints(c *gin.Context) {
	items := make([]models.ServicePoint, 0)
	if err := config.DB.Order("id ASC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลจุดบริการได้"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func CreateServicePoint(c *gin.Context) {
	var req servicePointRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณากรอกชื่อจุดบริการ"})
		return
	}

	if req.NodeID != nil && *req.NodeID > 0 {
		var count int64
		if err := config.DB.Model(&models.MapNode{}).Where("id = ?", *req.NodeID).Count(&count).Error; err != nil || count == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบอาคาร (node_id) ที่ผูกไว้ในระบบ"})
			return
		}
	} else {
		req.NodeID = nil
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	spType := strings.TrimSpace(req.Type)
	if spType == "" {
		spType = "general"
	}

	item := models.ServicePoint{
		NodeID:      req.NodeID,
		Type:        spType,
		Name:        strings.TrimSpace(req.Name),
		Description: strings.TrimSpace(req.Description),
		Phone:       strings.TrimSpace(req.Phone),
		IsActive:    isActive,
	}
	if err := config.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถสร้างจุดบริการได้"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func UpdateServicePoint(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสจุดบริการไม่ถูกต้อง"})
		return
	}
	var req servicePointRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ข้อมูลจุดบริการไม่ถูกต้อง"})
		return
	}

	if req.NodeID != nil && *req.NodeID > 0 {
		var count int64
		if err := config.DB.Model(&models.MapNode{}).Where("id = ?", *req.NodeID).Count(&count).Error; err != nil || count == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ไม่พบอาคาร (node_id) ที่ผูกไว้ในระบบ"})
			return
		}
	} else {
		req.NodeID = nil
	}

	var item models.ServicePoint
	if err := config.DB.First(&item, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบจุดบริการที่ต้องการแก้ไข"})
		return
	}

	item.NodeID = req.NodeID
	if strings.TrimSpace(req.Type) != "" {
		item.Type = strings.TrimSpace(req.Type)
	}
	item.Name = strings.TrimSpace(req.Name)
	item.Description = strings.TrimSpace(req.Description)
	item.Phone = strings.TrimSpace(req.Phone)
	if req.IsActive != nil {
		item.IsActive = *req.IsActive
	}

	if err := config.DB.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกจุดบริการได้"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func DeleteServicePoint(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสจุดบริการไม่ถูกต้อง"})
		return
	}
	res := config.DB.Delete(&models.ServicePoint{}, id)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบจุดบริการได้"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบจุดบริการที่ต้องการลบ"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ลบจุดบริการเรียบร้อยแล้ว", "id": id})
}

// ==================== ANNOUNCEMENTS ====================

type announcementRequest struct {
	Title     string  `json:"title" binding:"required"`
	Message   string  `json:"message" binding:"required"`
	Level     string  `json:"level"`
	IsActive  *bool   `json:"is_active"`
	ExpiresAt *string `json:"expires_at"`
}

func parseOptionalTime(raw *string) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	s := strings.TrimSpace(*raw)
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02T15:04",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return &t, nil
		}
	}
	return nil, http.ErrNotSupported
}

func GetPublicAnnouncements(c *gin.Context) {
	items := make([]models.Announcement, 0)
	now := time.Now()
	if err := config.DB.
		Where("is_active = ? AND (expires_at IS NULL OR expires_at > ?)", true, now).
		Order("id DESC").
		Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงประกาศได้"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func GetAdminAnnouncements(c *gin.Context) {
	items := make([]models.Announcement, 0)
	if err := config.DB.Order("id DESC").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงประกาศได้"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func CreateAnnouncement(c *gin.Context) {
	var req announcementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณากรอกหัวข้อและข้อความประกาศ"})
		return
	}
	exp, err := parseOptionalTime(req.ExpiresAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบวันหมดอายุ (expires_at) ไม่ถูกต้อง"})
		return
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	level := strings.TrimSpace(req.Level)
	if level == "" {
		level = "info"
	}

	item := models.Announcement{
		Title:     strings.TrimSpace(req.Title),
		Message:   strings.TrimSpace(req.Message),
		Level:     level,
		IsActive:  isActive,
		ExpiresAt: exp,
	}
	if err := config.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถสร้างประกาศได้"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func UpdateAnnouncement(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสประกาศไม่ถูกต้อง"})
		return
	}
	var req announcementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ข้อมูลประกาศไม่ถูกต้อง"})
		return
	}
	exp, err := parseOptionalTime(req.ExpiresAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบวันหมดอายุ (expires_at) ไม่ถูกต้อง"})
		return
	}

	var item models.Announcement
	if err := config.DB.First(&item, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบประกาศที่ต้องการแก้ไข"})
		return
	}

	item.Title = strings.TrimSpace(req.Title)
	item.Message = strings.TrimSpace(req.Message)
	if strings.TrimSpace(req.Level) != "" {
		item.Level = strings.TrimSpace(req.Level)
	}
	if req.IsActive != nil {
		item.IsActive = *req.IsActive
	}
	item.ExpiresAt = exp

	if err := config.DB.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกประกาศได้"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func DeleteAnnouncement(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสประกาศไม่ถูกต้อง"})
		return
	}
	res := config.DB.Delete(&models.Announcement{}, id)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบประกาศได้"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบประกาศที่ต้องการลบ"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ลบประกาศเรียบร้อยแล้ว", "id": id})
}
