-- Sakon Nakhon Hospital Navigation System — PostgreSQL + PostGIS Schema
-- Idempotent script: safe to run on both fresh and existing `hospital_nav` databases.
-- Note: `go run main.go` automatically runs non-destructive migrations and seeds
-- default admin (`admin` / `admin1234`), buildings, edges, categories, departments,
-- service points, and announcements when empty.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    id VARCHAR(64) PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    remember_me BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS map_versions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    is_live BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_nodes (
    id SERIAL PRIMARY KEY,
    version_id INTEGER REFERENCES map_versions(id) ON DELETE CASCADE,
    name VARCHAR(255) DEFAULT '',
    is_building BOOLEAN DEFAULT FALSE,
    keywords TEXT DEFAULT '',
    indoor_guide TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_edges (
    id SERIAL PRIMARY KEY,
    version_id INTEGER REFERENCES map_versions(id) ON DELETE CASCADE,
    from_node INTEGER NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
    to_node INTEGER NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
    distance_m DOUBLE PRECISION NOT NULL,
    instruction TEXT DEFAULT '',
    is_wheelchair_friendly BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    is_covered BOOLEAN DEFAULT FALSE,
    is_indoor_passthrough BOOLEAN DEFAULT FALSE,
    closure_reason TEXT DEFAULT '',
    geom GEOMETRY(LineString, 4326) NOT NULL
);

-- Upgrade existing map_nodes and map_edges safely without dropping data
ALTER TABLE map_nodes ADD COLUMN IF NOT EXISTS version_id INTEGER;
ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS version_id INTEGER;
ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS is_covered BOOLEAN DEFAULT FALSE;
ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS is_indoor_passthrough BOOLEAN DEFAULT FALSE;
ALTER TABLE map_edges ADD COLUMN IF NOT EXISTS closure_reason TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS survey_tracks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    zone VARCHAR(120) DEFAULT '',
    status VARCHAR(30) NOT NULL DEFAULT 'in_progress',
    color_hex VARCHAR(20) DEFAULT '',
    points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE survey_tracks ADD COLUMN IF NOT EXISTS zone VARCHAR(120) DEFAULT '';
ALTER TABLE survey_tracks ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'in_progress';
ALTER TABLE survey_tracks ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) DEFAULT '';

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    color_hex VARCHAR(20) NOT NULL DEFAULT '#0F766E',
    badge_bg VARCHAR(20) NOT NULL DEFAULT '#CCFBF1',
    sort_order INTEGER NOT NULL DEFAULT 0,
    show_in_legend BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    floor VARCHAR(100) DEFAULT '',
    operating_hours VARCHAR(255) DEFAULT '',
    phone VARCHAR(100) DEFAULT '',
    keywords TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_points (
    id SERIAL PRIMARY KEY,
    node_id INTEGER REFERENCES map_nodes(id) ON DELETE SET NULL,
    type VARCHAR(80) NOT NULL DEFAULT 'general',
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    phone VARCHAR(100) DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    level VARCHAR(40) NOT NULL DEFAULT 'info',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_map_nodes_geom ON map_nodes USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_map_nodes_version_id ON map_nodes (version_id);
CREATE INDEX IF NOT EXISTS idx_map_edges_geom ON map_edges USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_map_edges_version_id ON map_edges (version_id);
CREATE INDEX IF NOT EXISTS idx_map_edges_from_to ON map_edges (from_node, to_node);
CREATE INDEX IF NOT EXISTS idx_map_versions_is_live ON map_versions (is_live);
CREATE INDEX IF NOT EXISTS idx_departments_node_id ON departments (node_id);
CREATE INDEX IF NOT EXISTS idx_service_points_node_id ON service_points (node_id);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active);
