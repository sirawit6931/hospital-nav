package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// JSONB wraps json.RawMessage so GORM and pgx read/write PostgreSQL jsonb columns cleanly.
type JSONB json.RawMessage

// Value implements driver.Valuer for PostgreSQL jsonb writes.
func (j JSONB) Value() (driver.Value, error) {
	if len(j) == 0 {
		return "[]", nil
	}
	if !json.Valid(j) {
		return nil, errors.New("invalid JSONB payload")
	}
	return string(j), nil
}

// Scan implements sql.Scanner for PostgreSQL jsonb reads.
func (j *JSONB) Scan(value any) error {
	if value == nil {
		*j = JSONB("null")
		return nil
	}
	switch v := value.(type) {
	case []byte:
		cp := make([]byte, len(v))
		copy(cp, v)
		*j = JSONB(cp)
		return nil
	case string:
		*j = JSONB([]byte(v))
		return nil
	default:
		return fmt.Errorf("unsupported type for JSONB: %T", value)
	}
}

// MarshalJSON outputs the raw JSON bytes directly.
func (j JSONB) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return json.RawMessage(j).MarshalJSON()
}

// UnmarshalJSON stores incoming JSON bytes directly.
func (j *JSONB) UnmarshalJSON(data []byte) error {
	if j == nil {
		return errors.New("models.JSONB: UnmarshalJSON on nil pointer")
	}
	cp := make([]byte, len(data))
	copy(cp, data)
	*j = JSONB(cp)
	return nil
}

// Admin represents an administrator account in the `admins` table.
type Admin struct {
	ID           uint      `gorm:"primaryKey;column:id" json:"id"`
	Username     string    `gorm:"column:username;type:varchar(100);uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"column:password_hash;type:text;not null" json:"-"`
	CreatedAt    time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (Admin) TableName() string {
	return "admins"
}

// MapNode represents a building or navigation waypoint in the `map_nodes` table.
type MapNode struct {
	ID          uint      `gorm:"primaryKey;column:id" json:"id"`
	Name        string    `gorm:"column:name;type:varchar(255)" json:"name"`
	IsBuilding  bool      `gorm:"column:is_building;default:false" json:"is_building"`
	Keywords    string    `gorm:"column:keywords;type:text" json:"keywords"`
	IndoorGuide string    `gorm:"column:indoor_guide;type:text" json:"indoor_guide"`
	ImageURL    string    `gorm:"column:image_url;type:text" json:"image_url"`
	Lat         float64   `gorm:"column:lat;type:double precision;not null" json:"lat"`
	Lng         float64   `gorm:"column:lng;type:double precision;not null" json:"lng"`
	Geom        string    `gorm:"column:geom;type:geometry(Point,4326);->" json:"-"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (MapNode) TableName() string {
	return "map_nodes"
}

// MapEdge represents a path segment connecting two nodes in the `map_edges` table.
type MapEdge struct {
	ID                   uint      `gorm:"primaryKey;column:id" json:"id"`
	FromNode             uint      `gorm:"column:from_node;not null" json:"from_node"`
	ToNode               uint      `gorm:"column:to_node;not null" json:"to_node"`
	DistanceM            float64   `gorm:"column:distance_m;type:double precision;not null" json:"distance_m"`
	Instruction          string    `gorm:"column:instruction;type:text" json:"instruction"`
	IsWheelchairFriendly bool      `gorm:"column:is_wheelchair_friendly;default:true" json:"is_wheelchair_friendly"`
	IsActive             bool      `gorm:"column:is_active;default:true" json:"is_active"`
	Geom                 string    `gorm:"column:geom;type:geometry(LineString,4326);->" json:"-"`
}

func (MapEdge) TableName() string {
	return "map_edges"
}

// SurveyTrack represents a recorded GPS survey track in the `survey_tracks` table.
type SurveyTrack struct {
	ID           uint      `gorm:"primaryKey;column:id" json:"id"`
	Name         string    `gorm:"column:name;type:varchar(255);not null" json:"name"`
	PointsJSON   JSONB     `gorm:"column:points_json;type:jsonb;not null" json:"points_json"`
	CreatedAt    time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (SurveyTrack) TableName() string {
	return "survey_tracks"
}
