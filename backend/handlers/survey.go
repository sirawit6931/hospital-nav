package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"hospital-nav-backend/config"
	"hospital-nav-backend/models"
)

var surveyColorPalette = []string{
	"#F97316", // Orange
	"#8B5CF6", // Violet
	"#EC4899", // Pink
	"#10B981", // Emerald
	"#06B6D4", // Cyan
	"#EAB308", // Amber/Yellow
	"#6366F1", // Indigo
	"#EF4444", // Red
}

func normalizeSurveyStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "completed", "done":
		return "completed"
	default:
		return "in_progress"
	}
}

func pickNextSurveyColor() string {
	var count int64
	config.DB.Model(&models.SurveyTrack{}).Count(&count)
	return surveyColorPalette[int(count)%len(surveyColorPalette)]
}

func parseSurveyPoints(raw models.JSONB) ([][2]float64, error) {
	var pts [][2]float64
	if len(raw) == 0 {
		return pts, nil
	}
	if err := json.Unmarshal(raw, &pts); err != nil {
		return nil, err
	}
	return pts, nil
}

func encodeSurveyPoints(pts [][2]float64) (models.JSONB, error) {
	b, err := json.Marshal(pts)
	if err != nil {
		return nil, err
	}
	return models.JSONB(b), nil
}

func haversineMeters(a, b [2]float64) float64 {
	const R = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180.0 }
	dLat := toRad(b[0] - a[0])
	dLng := toRad(b[1] - a[1])
	sinLat := math.Sin(dLat / 2)
	sinLng := math.Sin(dLng / 2)
	h := sinLat*sinLat + math.Cos(toRad(a[0]))*math.Cos(toRad(b[0]))*sinLng*sinLng
	return 2 * R * math.Atan2(math.Sqrt(h), math.Sqrt(1-h))
}

func reversePoints(pts [][2]float64) [][2]float64 {
	out := make([][2]float64, len(pts))
	for i := range pts {
		out[i] = pts[len(pts)-1-i]
	}
	return out
}

type createSurveyRequest struct {
	Name       string       `json:"name" binding:"required"`
	Zone       string       `json:"zone"`
	Status     string       `json:"status"`
	ColorHex   string       `json:"color_hex"`
	PointsJSON models.JSONB `json:"points_json" binding:"required"`
}

type updateSurveyMetaRequest struct {
	Name     *string `json:"name"`
	Zone     *string `json:"zone"`
	Status   *string `json:"status"`
	ColorHex *string `json:"color_hex"`
}

type appendSurveyRequest struct {
	PointsJSON [][2]float64 `json:"points_json" binding:"required"`
	Name       *string      `json:"name"`
	Zone       *string      `json:"zone"`
	Status     *string      `json:"status"`
}

type mergeSurveysRequest struct {
	TrackIDs        []uint `json:"track_ids" binding:"required"`
	Name            string `json:"name"`
	Zone            string `json:"zone"`
	Status          string `json:"status"`
	DeleteOriginals bool   `json:"delete_originals"`
}

type splitSurveyRequest struct {
	SplitIndex *int     `json:"split_index"`
	Lat        *float64 `json:"lat"`
	Lng        *float64 `json:"lng"`
}

// GetSurveys returns all recorded mobile GPS survey tracks.
func GetSurveys(c *gin.Context) {
	surveys := make([]models.SurveyTrack, 0)
	if err := config.DB.Order("created_at DESC, id DESC").Find(&surveys).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "ไม่สามารถดึงรายการรอยเดินสำรวจได้",
		})
		return
	}

	// Ensure legacy rows always have a valid status and color for UI
	for i := range surveys {
		if strings.TrimSpace(surveys[i].Status) == "" {
			surveys[i].Status = "in_progress"
		}
		if strings.TrimSpace(surveys[i].ColorHex) == "" {
			surveys[i].ColorHex = surveyColorPalette[int(surveys[i].ID)%len(surveyColorPalette)]
		}
	}

	c.JSON(http.StatusOK, surveys)
}

// CreateSurvey saves a new mobile GPS survey track (points_json, zone, status, color_hex).
func CreateSurvey(c *gin.Context) {
	var req createSurveyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "ข้อมูลรอยเดินไม่ครบถ้วน (ต้องมีชื่อและพิกัด points_json)",
		})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "กรุณาระบุชื่อรอยเดินสำรวจ",
		})
		return
	}

	if len(req.PointsJSON) == 0 || !json.Valid(req.PointsJSON) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "points_json must be valid JSON",
		})
		return
	}

	colorHex := strings.TrimSpace(req.ColorHex)
	if colorHex == "" {
		colorHex = pickNextSurveyColor()
	}

	track := models.SurveyTrack{
		Name:       name,
		Zone:       strings.TrimSpace(req.Zone),
		Status:     normalizeSurveyStatus(req.Status),
		ColorHex:   colorHex,
		PointsJSON: req.PointsJSON,
	}

	if err := config.DB.Create(&track).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "ไม่สามารถบันทึกรอยเดินสำรวจได้",
		})
		return
	}

	c.JSON(http.StatusCreated, track)
}

// UpdateSurvey updates metadata (name, zone, status, color_hex) of a survey track.
func UpdateSurvey(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสรอยเดินไม่ถูกต้อง"})
		return
	}

	var req updateSurveyMetaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบข้อมูลไม่ถูกต้อง"})
		return
	}

	var track models.SurveyTrack
	if err := config.DB.First(&track, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบรอยเดินสำรวจที่ระบุ"})
		return
	}

	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		track.Name = strings.TrimSpace(*req.Name)
	}
	if req.Zone != nil {
		track.Zone = strings.TrimSpace(*req.Zone)
	}
	if req.Status != nil {
		track.Status = normalizeSurveyStatus(*req.Status)
	}
	if req.ColorHex != nil && strings.TrimSpace(*req.ColorHex) != "" {
		track.ColorHex = strings.TrimSpace(*req.ColorHex)
	}

	if err := config.DB.Save(&track).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอัปเดตข้อมูลรอยเดินได้"})
		return
	}

	c.JSON(http.StatusOK, track)
}

// AppendSurveyTrack appends newly recorded GPS coordinates onto the end of an existing survey track.
func AppendSurveyTrack(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสรอยเดินไม่ถูกต้อง"})
		return
	}

	var req appendSurveyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รูปแบบพิกัดที่จะต่อท้ายไม่ถูกต้อง"})
		return
	}

	var track models.SurveyTrack
	if err := config.DB.First(&track, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบรอยเดินสำรวจที่ต้องการอัดต่อ"})
		return
	}

	existingPts, err := parseSurveyPoints(track.PointsJSON)
	if err != nil {
		existingPts = [][2]float64{}
	}

	combined := make([][2]float64, 0, len(existingPts)+len(req.PointsJSON))
	combined = append(combined, existingPts...)
	for _, pt := range req.PointsJSON {
		if len(combined) > 0 && haversineMeters(combined[len(combined)-1], pt) < 1.0 {
			continue
		}
		combined = append(combined, pt)
	}

	encoded, err := encodeSurveyPoints(combined)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถเข้ารหัสพิกัดได้"})
		return
	}

	track.PointsJSON = encoded
	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		track.Name = strings.TrimSpace(*req.Name)
	}
	if req.Zone != nil {
		track.Zone = strings.TrimSpace(*req.Zone)
	}
	if req.Status != nil {
		track.Status = normalizeSurveyStatus(*req.Status)
	}
	if strings.TrimSpace(track.ColorHex) == "" {
		track.ColorHex = surveyColorPalette[int(track.ID)%len(surveyColorPalette)]
	}

	if err := config.DB.Save(&track).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถบันทึกการอัดต่อรอยเดินได้"})
		return
	}

	c.JSON(http.StatusOK, track)
}

// MergeSurveyTracks joins 2 or more survey tracks into a single continuous track
// ordered greedily by nearest endpoints (reversing segments automatically if needed).
func MergeSurveyTracks(c *gin.Context) {
	var req mergeSurveysRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.TrackIDs) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาเลือกรอยเดินอย่างน้อย 2 เส้นเพื่อนำมารวมกัน"})
		return
	}

	var tracks []models.SurveyTrack
	if err := config.DB.Where("id IN ?", req.TrackIDs).Find(&tracks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถโหลดข้อมูลรอยเดินได้"})
		return
	}
	if len(tracks) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "พบรอยเดินที่เลือกไม่ครบอย่างน้อย 2 เส้น"})
		return
	}

	// Preserve user selection order for the starting segment
	trackByID := make(map[uint]models.SurveyTrack, len(tracks))
	for _, t := range tracks {
		trackByID[t.ID] = t
	}

	type segment struct {
		track models.SurveyTrack
		pts   [][2]float64
	}
	segments := make([]segment, 0, len(req.TrackIDs))
	seen := make(map[uint]bool)
	for _, id := range req.TrackIDs {
		if seen[id] {
			continue
		}
		t, ok := trackByID[id]
		if !ok {
			continue
		}
		seen[id] = true
		pts, err := parseSurveyPoints(t.PointsJSON)
		if err != nil || len(pts) < 2 {
			continue
		}
		segments = append(segments, segment{track: t, pts: pts})
	}
	if len(segments) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รอยเดินที่เลือกต้องมีพิกัดอย่างน้อย 2 จุดต่อเส้น"})
		return
	}

	// Greedy nearest-endpoint chaining
	used := make([]bool, len(segments))
	used[0] = true
	mergedPts := make([][2]float64, 0, len(segments[0].pts)*len(segments))
	mergedPts = append(mergedPts, segments[0].pts...)

	for step := 1; step < len(segments); step++ {
		tail := mergedPts[len(mergedPts)-1]
		bestIdx := -1
		bestDist := math.MaxFloat64
		bestReverse := false

		for i := 0; i < len(segments); i++ {
			if used[i] {
				continue
			}
			pts := segments[i].pts
			dStart := haversineMeters(tail, pts[0])
			if dStart < bestDist {
				bestDist = dStart
				bestIdx = i
				bestReverse = false
			}
			dEnd := haversineMeters(tail, pts[len(pts)-1])
			if dEnd < bestDist {
				bestDist = dEnd
				bestIdx = i
				bestReverse = true
			}
		}

		if bestIdx == -1 {
			break
		}
		used[bestIdx] = true
		nextPts := segments[bestIdx].pts
		if bestReverse {
			nextPts = reversePoints(nextPts)
		}
		for _, pt := range nextPts {
			if len(mergedPts) > 0 && haversineMeters(mergedPts[len(mergedPts)-1], pt) < 1.0 {
				continue
			}
			mergedPts = append(mergedPts, pt)
		}
	}

	encoded, err := encodeSurveyPoints(mergedPts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถเข้ารหัสพิกัดที่รวมแล้วได้"})
		return
	}

	mergedName := strings.TrimSpace(req.Name)
	if mergedName == "" {
		mergedName = fmt.Sprintf("รวมรอยเดิน %d เส้น (%s)", len(segments), segments[0].track.Name)
	}
	mergedZone := strings.TrimSpace(req.Zone)
	if mergedZone == "" {
		mergedZone = segments[0].track.Zone
	}

	var created models.SurveyTrack
	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		created = models.SurveyTrack{
			Name:       mergedName,
			Zone:       mergedZone,
			Status:     normalizeSurveyStatus(req.Status),
			ColorHex:   pickNextSurveyColor(),
			PointsJSON: encoded,
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		if req.DeleteOriginals {
			if err := tx.Where("id IN ?", req.TrackIDs).Delete(&models.SurveyTrack{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถรวมรอยเดินสำรวจได้"})
		return
	}

	c.JSON(http.StatusCreated, created)
}

// SplitSurveyTrack splits a single survey track into 2 contiguous tracks at the specified index or nearest lat/lng.
func SplitSurveyTrack(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รหัสรอยเดินไม่ถูกต้อง"})
		return
	}

	var req splitSurveyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาระบุตำแหน่งจุดที่ต้องการตัดแบ่ง"})
		return
	}

	var original models.SurveyTrack
	if err := config.DB.First(&original, uint(id)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบรอยเดินที่ต้องการตัดแบ่ง"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถโหลดข้อมูลรอยเดินได้"})
		return
	}

	pts, err := parseSurveyPoints(original.PointsJSON)
	if err != nil || len(pts) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "รอยเดินต้องมีอย่างน้อย 3 พิกัดจึงจะตัดแบ่งเป็น 2 ท่อนได้"})
		return
	}

	splitIdx := -1
	if req.SplitIndex != nil {
		splitIdx = *req.SplitIndex
	} else if req.Lat != nil && req.Lng != nil {
		clickPt := [2]float64{*req.Lat, *req.Lng}
		bestDist := math.MaxFloat64
		// Find closest interior vertex (1 .. len-2) so both halves have >= 2 points
		for i := 1; i < len(pts)-1; i++ {
			d := haversineMeters(clickPt, pts[i])
			if d < bestDist {
				bestDist = d
				splitIdx = i
			}
		}
	}

	if splitIdx < 1 || splitIdx >= len(pts)-1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ตำแหน่งตัดแบ่งต้องอยู่ระหว่างจุดเริ่มต้นและจุดสิ้นสุดของเส้น"})
		return
	}

	part1Pts := pts[:splitIdx+1]
	part2Pts := pts[splitIdx:]

	enc1, err := encodeSurveyPoints(part1Pts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถเข้ารหัสพิกัดท่อนที่ 1 ได้"})
		return
	}
	enc2, err := encodeSurveyPoints(part2Pts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถเข้ารหัสพิกัดท่อนที่ 2 ได้"})
		return
	}

	var part1, part2 models.SurveyTrack
	txErr := config.DB.Transaction(func(tx *gorm.DB) error {
		color1 := strings.TrimSpace(original.ColorHex)
		if color1 == "" {
			color1 = surveyColorPalette[int(original.ID)%len(surveyColorPalette)]
		}
		color2 := surveyColorPalette[(int(original.ID)+3)%len(surveyColorPalette)]

		part1 = models.SurveyTrack{
			Name:       fmt.Sprintf("%s (ท่อน 1)", original.Name),
			Zone:       original.Zone,
			Status:     normalizeSurveyStatus(original.Status),
			ColorHex:   color1,
			PointsJSON: enc1,
		}
		part2 = models.SurveyTrack{
			Name:       fmt.Sprintf("%s (ท่อน 2)", original.Name),
			Zone:       original.Zone,
			Status:     normalizeSurveyStatus(original.Status),
			ColorHex:   color2,
			PointsJSON: enc2,
		}
		if err := tx.Create(&part1).Error; err != nil {
			return err
		}
		if err := tx.Create(&part2).Error; err != nil {
			return err
		}
		return tx.Delete(&models.SurveyTrack{}, original.ID).Error
	})
	if txErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถตัดแบ่งรอยเดินสำรวจได้"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tracks":     []models.SurveyTrack{part1, part2},
		"deleted_id": original.ID,
	})
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
