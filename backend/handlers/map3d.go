package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/gin-gonic/gin"
)

const map3DOverridesFile = "uploads/custom_3d_overrides.json"

var map3DMu sync.RWMutex

// Building3DOverride represents admin customizations to an existing 3D building footprint.
type Building3DOverride struct {
	ID           string   `json:"id"`
	Name         string   `json:"name,omitempty"`
	ShortName    string   `json:"short_name,omitempty"`
	CenterLat    float64  `json:"center_lat"`
	CenterLng    float64  `json:"center_lng"`
	WidthM       float64  `json:"width_m"`
	DepthM       float64  `json:"depth_m"`
	AngleDeg     float64  `json:"angle_deg"`
	Height       float64  `json:"height"`
	BaseHeight   float64  `json:"base_height"`
	Color        string   `json:"color"`
	Hidden       bool     `json:"hidden,omitempty"`
	LinkedNodeID *uint    `json:"linked_node_id,omitempty"`
	ScaleX       *float64 `json:"scale_x,omitempty"`
	ScaleY       *float64 `json:"scale_y,omitempty"`
}

// Custom3DPart represents an admin-created extruded 3D wing or standalone custom building box.
type Custom3DPart struct {
	ID           string  `json:"id"`
	ParentID     string  `json:"parent_id,omitempty"`
	Name         string  `json:"name"`
	ShortName    string  `json:"short_name"`
	IsWing       bool    `json:"is_wing"`
	CenterLat    float64 `json:"center_lat"`
	CenterLng    float64 `json:"center_lng"`
	WidthM       float64 `json:"width_m"`
	DepthM       float64 `json:"depth_m"`
	AngleDeg     float64 `json:"angle_deg"`
	Height       float64 `json:"height"`
	BaseHeight   float64 `json:"base_height"`
	Color        string  `json:"color"`
	LinkedNodeID *uint   `json:"linked_node_id,omitempty"`
}

// Map3DOverridesPayload stores all admin 3D building edits & added extruded wings.
type Map3DOverridesPayload struct {
	Overrides   map[string]Building3DOverride `json:"overrides"`
	CustomParts []Custom3DPart                `json:"custom_parts"`
}

func defaultMap3DPayload() Map3DOverridesPayload {
	return Map3DOverridesPayload{
		Overrides:   map[string]Building3DOverride{},
		CustomParts: []Custom3DPart{},
	}
}

// GetMap3DOverrides returns saved 3D model customizations for both public & admin maps.
func GetMap3DOverrides(c *gin.Context) {
	map3DMu.RLock()
	defer map3DMu.RUnlock()

	data, err := os.ReadFile(map3DOverridesFile)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, defaultMap3DPayload())
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอ่านข้อมูลการปรับแต่งโมเดล 3D ได้"})
		return
	}

	var payload Map3DOverridesPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		c.JSON(http.StatusOK, defaultMap3DPayload())
		return
	}
	if payload.Overrides == nil {
		payload.Overrides = map[string]Building3DOverride{}
	}
	if payload.CustomParts == nil {
		payload.CustomParts = []Custom3DPart{}
	}

	c.JSON(http.StatusOK, payload)
}

// SaveMap3DOverrides persists admin 3D building customizations & custom extruded wings.
func SaveMap3DOverrides(c *gin.Context) {
	var payload Map3DOverridesPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบข้อมูลโมเดล 3D ไม่ถูกต้อง"})
		return
	}

	if payload.Overrides == nil {
		payload.Overrides = map[string]Building3DOverride{}
	}
	if payload.CustomParts == nil {
		payload.CustomParts = []Custom3DPart{}
	}

	map3DMu.Lock()
	defer map3DMu.Unlock()

	if err := os.MkdirAll(filepath.Dir(map3DOverridesFile), 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถสร้างโฟลเดอร์จัดเก็บข้อมูลได้"})
		return
	}

	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถเข้ารหัสข้อมูลโมเดล 3D ได้"})
		return
	}

	tmpPath := map3DOverridesFile + ".tmp"
	if err := os.WriteFile(tmpPath, encoded, 0o644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกข้อมูลโมเดล 3D ได้"})
		return
	}
	if err := os.Rename(tmpPath, map3DOverridesFile); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอัปเดตไฟล์โมเดล 3D ได้"})
		return
	}

	c.JSON(http.StatusOK, payload)
}
