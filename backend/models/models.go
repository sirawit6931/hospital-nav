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

// AdminSession tracks server-side revocable admin sessions backed by HttpOnly JWT cookies.
type AdminSession struct {
	ID         string    `gorm:"primaryKey;column:id;type:varchar(64)" json:"id"`
	AdminID    uint      `gorm:"column:admin_id;not null;index" json:"admin_id"`
	RememberMe bool      `gorm:"column:remember_me;not null;default:false" json:"remember_me"`
	ExpiresAt  time.Time `gorm:"column:expires_at;not null;index" json:"expires_at"`
	Revoked    bool      `gorm:"column:revoked;not null;default:false;index" json:"revoked"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt  time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

func (AdminSession) TableName() string {
	return "admin_sessions"
}

// MapVersion represents a versioned map snapshot (Live or Draft) in the `map_versions` table.
type MapVersion struct {
	ID          uint      `gorm:"primaryKey;column:id" json:"id"`
	Name        string    `gorm:"column:name;type:varchar(255);not null" json:"name"`
	Description string    `gorm:"column:description;type:text;default:''" json:"description"`
	IsLive      bool      `gorm:"column:is_live;not null;default:false;index" json:"is_live"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

func (MapVersion) TableName() string {
	return "map_versions"
}

// MapNode represents a building or navigation waypoint in the `map_nodes` table.
type MapNode struct {
	ID            uint         `gorm:"primaryKey;column:id" json:"id"`
	VersionID     uint         `gorm:"column:version_id;not null;default:1;index" json:"version_id"`
	Name          string       `gorm:"column:name;type:varchar(255)" json:"name"`
	IsBuilding    bool         `gorm:"column:is_building;default:false" json:"is_building"`
	BuildingCode  string       `gorm:"column:building_code;type:varchar(50);not null;default:''" json:"building_code"`
	BadgeLabel    string       `gorm:"column:badge_label;type:varchar(50);not null;default:''" json:"badge_label"`
	FloorRange    string       `gorm:"column:floor_range;type:varchar(50);not null;default:''" json:"floor_range"`
	ServiceStatus string       `gorm:"column:service_status;type:varchar(40);not null;default:'open'" json:"service_status"`
	CategoryID    *uint        `gorm:"column:category_id;index" json:"category_id"`
	Keywords      string       `gorm:"column:keywords;type:text" json:"keywords"`
	IndoorGuide   string       `gorm:"column:indoor_guide;type:text" json:"indoor_guide"`
	ImageURL      string       `gorm:"column:image_url;type:text" json:"image_url"`
	ImageURLs     JSONB        `gorm:"column:image_urls;type:jsonb;not null;default:'[]'" json:"image_urls"`
	Lat           float64      `gorm:"column:lat;type:double precision;not null" json:"lat"`
	Lng           float64      `gorm:"column:lng;type:double precision;not null" json:"lng"`
	Geom          string       `gorm:"column:geom;type:geometry(Point,4326);->" json:"-"`
	CreatedAt     time.Time    `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	Departments   []Department `gorm:"foreignKey:NodeID;references:ID" json:"departments,omitempty"`
}

func (MapNode) TableName() string {
	return "map_nodes"
}

// MapEdge represents a path segment connecting two nodes in the `map_edges` table.
type MapEdge struct {
	ID                   uint    `gorm:"primaryKey;column:id" json:"id"`
	VersionID            uint    `gorm:"column:version_id;not null;default:1;index" json:"version_id"`
	FromNode             uint    `gorm:"column:from_node;not null" json:"from_node"`
	ToNode               uint    `gorm:"column:to_node;not null" json:"to_node"`
	DistanceM            float64 `gorm:"column:distance_m;type:double precision;not null" json:"distance_m"`
	Instruction          string  `gorm:"column:instruction;type:text" json:"instruction"`
	IsWheelchairFriendly bool    `gorm:"column:is_wheelchair_friendly;default:true" json:"is_wheelchair_friendly"`
	IsActive             bool    `gorm:"column:is_active;default:true" json:"is_active"`
	IsCovered            bool    `gorm:"column:is_covered;default:false" json:"is_covered"`
	IsIndoorPassthrough  bool    `gorm:"column:is_indoor_passthrough;default:false" json:"is_indoor_passthrough"`
	ClosureReason        string  `gorm:"column:closure_reason;type:text;default:''" json:"closure_reason"`
	Geom                 string  `gorm:"column:geom;type:geometry(LineString,4326);->" json:"-"`
}

func (MapEdge) TableName() string {
	return "map_edges"
}

// SurveyTrack represents a recorded GPS survey track in the `survey_tracks` table.
type SurveyTrack struct {
	ID         uint      `gorm:"primaryKey;column:id" json:"id"`
	Name       string    `gorm:"column:name;type:varchar(255);not null" json:"name"`
	Zone       string    `gorm:"column:zone;type:varchar(120);default:''" json:"zone"`
	Status     string    `gorm:"column:status;type:varchar(30);not null;default:'in_progress'" json:"status"`
	ColorHex   string    `gorm:"column:color_hex;type:varchar(20);default:''" json:"color_hex"`
	PointsJSON JSONB     `gorm:"column:points_json;type:jsonb;not null" json:"points_json"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (SurveyTrack) TableName() string {
	return "survey_tracks"
}

// Category represents a building filter chip and map legend color category.
type Category struct {
	ID           uint      `gorm:"primaryKey;column:id" json:"id"`
	Name         string    `gorm:"column:name;type:varchar(150);not null" json:"name"`
	Slug         string    `gorm:"column:slug;type:varchar(100);uniqueIndex;not null" json:"slug"`
	ColorHex     string    `gorm:"column:color_hex;type:varchar(20);not null;default:'#0F766E'" json:"color_hex"`
	BadgeBg      string    `gorm:"column:badge_bg;type:varchar(20);not null;default:'#CCFBF1'" json:"badge_bg"`
	SortOrder    int       `gorm:"column:sort_order;not null;default:0" json:"sort_order"`
	ShowInLegend bool      `gorm:"column:show_in_legend;not null;default:true" json:"show_in_legend"`
	CreatedAt    time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (Category) TableName() string {
	return "categories"
}

// Department represents a clinic, ward, or medical unit located inside a hospital building node.
type Department struct {
	ID             uint      `gorm:"primaryKey;column:id" json:"id"`
	NodeID         uint      `gorm:"column:node_id;not null;index" json:"node_id"`
	Name           string    `gorm:"column:name;type:varchar(255);not null" json:"name"`
	Floor          string    `gorm:"column:floor;type:varchar(100);default:''" json:"floor"`
	OperatingHours string    `gorm:"column:operating_hours;type:varchar(255);default:''" json:"operating_hours"`
	Phone          string    `gorm:"column:phone;type:varchar(100);default:''" json:"phone"`
	Keywords       string    `gorm:"column:keywords;type:text;default:''" json:"keywords"`
	CreatedAt      time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (Department) TableName() string {
	return "departments"
}

// ServicePoint represents an emergency hotline, info desk, wheelchair station, or patient facility.
type ServicePoint struct {
	ID          uint      `gorm:"primaryKey;column:id" json:"id"`
	NodeID      *uint     `gorm:"column:node_id;index" json:"node_id"`
	Type        string    `gorm:"column:type;type:varchar(80);not null;default:'general'" json:"type"`
	Name        string    `gorm:"column:name;type:varchar(255);not null" json:"name"`
	Description string    `gorm:"column:description;type:text;default:''" json:"description"`
	Phone       string    `gorm:"column:phone;type:varchar(100);default:''" json:"phone"`
	IsActive    bool      `gorm:"column:is_active;not null;default:true" json:"is_active"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (ServicePoint) TableName() string {
	return "service_points"
}

// Announcement represents a public notice banner displayed on the hospital navigation app.
type Announcement struct {
	ID        uint       `gorm:"primaryKey;column:id" json:"id"`
	Title     string     `gorm:"column:title;type:varchar(255);not null" json:"title"`
	Message   string     `gorm:"column:message;type:text;not null" json:"message"`
	Level     string     `gorm:"column:level;type:varchar(40);not null;default:'info'" json:"level"`
	IsActive  bool       `gorm:"column:is_active;not null;default:true;index" json:"is_active"`
	ExpiresAt *time.Time `gorm:"column:expires_at" json:"expires_at"`
	CreatedAt time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

func (Announcement) TableName() string {
	return "announcements"
}

// AuditLog records admin changes across buildings, departments, categories, and 3D map nodes/edges
// with full before/after JSON snapshots to support one-click rollback.
type AuditLog struct {
	ID           uint      `gorm:"primaryKey;column:id" json:"id"`
	ActionType   string    `gorm:"column:action_type;type:varchar(60);not null;index" json:"action_type"`
	ActionLabel  string    `gorm:"column:action_label;type:varchar(100);not null" json:"action_label"`
	EntityType   string    `gorm:"column:entity_type;type:varchar(50);not null;index" json:"entity_type"`
	EntityID     uint      `gorm:"column:entity_id;not null;default:0" json:"entity_id"`
	BadgeText    string    `gorm:"column:badge_text;type:varchar(60);default:''" json:"badge_text"`
	TargetTitle  string    `gorm:"column:target_title;type:varchar(255);not null" json:"target_title"`
	Summary      string    `gorm:"column:summary;type:text;not null" json:"summary"`
	ActorName    string    `gorm:"column:actor_name;type:varchar(120);not null;default:'admin'" json:"actor_name"`
	BeforeJSON   JSONB     `gorm:"column:before_json;type:jsonb" json:"before_json"`
	AfterJSON    JSONB     `gorm:"column:after_json;type:jsonb" json:"after_json"`
	IsRolledBack bool      `gorm:"column:is_rolled_back;not null;default:false" json:"is_rolled_back"`
	CreatedAt    time.Time `gorm:"column:created_at;autoCreateTime;index" json:"created_at"`
}

func (AuditLog) TableName() string {
	return "audit_logs"
}
