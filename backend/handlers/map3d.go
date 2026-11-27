package handlers

import (
	"encoding/json"
	"fmt"
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

func map3DVersionFilePath(versionID uint) string {
	return fmt.Sprintf("uploads/custom_3d_overrides_v%d.json", versionID)
}

func readMap3DPayloadUnlocked(versionID uint) (Map3DOverridesPayload, error) {
	paths := []string{map3DVersionFilePath(versionID)}
	if liveID, err := ResolveLiveVersionID(); err == nil && liveID == versionID {
		paths = append(paths, map3DOverridesFile)
	}

	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return defaultMap3DPayload(), err
		}
		var payload Map3DOverridesPayload
		if err := json.Unmarshal(data, &payload); err != nil {
			return defaultMap3DPayload(), nil
		}
		if payload.Overrides == nil {
			payload.Overrides = map[string]Building3DOverride{}
		}
		if payload.CustomParts == nil {
			payload.CustomParts = []Custom3DPart{}
		}
		return payload, nil
	}

	return defaultMap3DPayload(), nil
}

func writeMap3DPayloadUnlocked(filePath string, payload Map3DOverridesPayload) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := filePath + ".tmp"
	if err := os.WriteFile(tmpPath, encoded, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, filePath)
}

// cloneMap3DOverridesFile deep-copies 3D overrides from srcVersionID to dstVersionID
// and remaps any linked_node_id using oldToNewNodeID.
func cloneMap3DOverridesFile(srcVersionID, dstVersionID uint, oldToNewNodeID map[uint]uint) error {
	map3DMu.Lock()
	defer map3DMu.Unlock()

	payload, err := readMap3DPayloadUnlocked(srcVersionID)
	if err != nil {
		return err
	}

	clonedOverrides := make(map[string]Building3DOverride, len(payload.Overrides))
	for k, ov := range payload.Overrides {
		if ov.LinkedNodeID != nil {
			if mapped, ok := oldToNewNodeID[*ov.LinkedNodeID]; ok {
				m := mapped
				ov.LinkedNodeID = &m
			} else {
				ov.LinkedNodeID = nil
			}
		}
		clonedOverrides[k] = ov
	}

	clonedParts := make([]Custom3DPart, len(payload.CustomParts))
	for i, part := range payload.CustomParts {
		if part.LinkedNodeID != nil {
			if mapped, ok := oldToNewNodeID[*part.LinkedNodeID]; ok {
				m := mapped
				part.LinkedNodeID = &m
			} else {
				part.LinkedNodeID = nil
			}
		}
		clonedParts[i] = part
	}

	return writeMap3DPayloadUnlocked(map3DVersionFilePath(dstVersionID), Map3DOverridesPayload{
		Overrides:   clonedOverrides,
		CustomParts: clonedParts,
	})
}

// syncLiveMap3DLegacyFile keeps uploads/custom_3d_overrides.json aligned with the current Live version.
func syncLiveMap3DLegacyFile(liveVersionID uint) {
	map3DMu.Lock()
	defer map3DMu.Unlock()

	if payload, err := readMap3DPayloadUnlocked(liveVersionID); err == nil {
		_ = writeMap3DPayloadUnlocked(map3DOverridesFile, payload)
	}
}

// GetMap3DOverrides returns saved 3D model customizations for the requested version_id / preview_version_id,
// defaulting to the current Live version for public users.
func GetMap3DOverrides(c *gin.Context) {
	versionID, err := ResolveRequestedVersionID(c, "version_id", "preview_version_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	map3DMu.RLock()
	payload, readErr := readMap3DPayloadUnlocked(versionID)
	map3DMu.RUnlock()

	if readErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอ่านข้อมูลการปรับแต่งโมเดล 3D ได้"})
		return
	}

	c.JSON(http.StatusOK, payload)
}

// SaveMap3DOverrides persists admin 3D building customizations & custom extruded wings
// scoped to the specified ?version_id=... (defaults to Live version if omitted).
func SaveMap3DOverrides(c *gin.Context) {
	versionID, err := ResolveRequestedVersionID(c, "version_id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

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
	writeErr := writeMap3DPayloadUnlocked(map3DVersionFilePath(versionID), payload)
	if writeErr == nil {
		if liveID, liveErr := ResolveLiveVersionID(); liveErr == nil && liveID == versionID {
			_ = writeMap3DPayloadUnlocked(map3DOverridesFile, payload)
		}
	}
	map3DMu.Unlock()

	if writeErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกข้อมูลโมเดล 3D ได้"})
		return
	}

	c.JSON(http.StatusOK, payload)
}
