-- Sakon Nakhon Hospital Navigation System — PostgreSQL + PostGIS Schema
-- Run once on a fresh `hospital_nav` database before starting `go run main.go`.
-- Note: `go run main.go` will automatically seed the default admin (`admin` / `admin1234`)
-- and all official Sakon Nakhon Hospital buildings & walkable edges when `map_nodes` is empty.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_nodes (
    id SERIAL PRIMARY KEY,
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
    from_node INTEGER NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
    to_node INTEGER NOT NULL REFERENCES map_nodes(id) ON DELETE CASCADE,
    distance_m DOUBLE PRECISION NOT NULL,
    instruction TEXT DEFAULT '',
    is_wheelchair_friendly BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    geom GEOMETRY(LineString, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS survey_tracks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    points_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_map_nodes_geom ON map_nodes USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_map_edges_geom ON map_edges USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_map_edges_from_to ON map_edges (from_node, to_node);
