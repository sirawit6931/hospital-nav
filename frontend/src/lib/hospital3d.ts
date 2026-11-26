import type { MapNode } from "./api";
import { calculateDistanceMeters, classifyBuilding } from "./hospital";

export type MapViewMode = "3d" | "satellite" | "street";

export interface GeoJSONPolygonFeature<P = Record<string, unknown>> {
  type: "Feature";
  id?: string | number;
  properties: P;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
}

export interface GeoJSONLineFeature<P = Record<string, unknown>> {
  type: "Feature";
  properties: P;
  geometry: {
    type: "LineString";
    coordinates: number[][];
  };
}

export interface GeoJSONPointFeature<P = Record<string, unknown>> {
  type: "Feature";
  properties: P;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

export interface Building3DProps {
  id: string;
  name: string;
  short_name: string;
  category:
    | "er"
    | "opd"
    | "specialty"
    | "diagnostic"
    | "maternal_child"
    | "support";
  levels: number;
  height: number;
  base_height: number;
  priority: number;
  keywords?: string;
  indoor_guide?: string;
  color: string;
  source: string;
  has_helipad?: boolean;
  center_lng: number;
  center_lat: number;
  linked_node_id?: number | null;
  is_target?: boolean;
  route_through?: boolean;
}

export interface Entrance3DProps {
  id: string;
  name: string;
  kind: "water" | "parking" | "entrance" | "er_entrance" | "helipad";
}

export interface BuildingLabelProps {
  id: string;
  name: string;
  short_name: string;
  category: string;
  priority: number;
  height: number;
  is_target: boolean;
  linked_node_id: number | null;
  sort_key: number;
}

export interface SakonHospital3DDataset {
  meta: {
    name: string;
    osmCampusWayId: number;
    center: [number, number];
    bounds: [[number, number], [number, number]];
  };
  campus: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<{ id: string; name: string }>[];
  };
  water: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<{ id: string; name: string }>[];
  };
  greens: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<{ id: string; name: string }>[];
  };
  parking: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<{
      id: string;
      name: string;
      short_name?: string;
    }>[];
  };
  roads: {
    type: "FeatureCollection";
    features: GeoJSONLineFeature<{
      id: string;
      highway: string;
      name: string;
      scope: "internal" | "major" | "external";
    }>[];
  };
  walkways: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<{
      id: string;
      name: string;
      height: number;
    }>[];
  };
  covered_walkway_lines?: {
    type: "FeatureCollection";
    features: GeoJSONLineFeature<{ id: string; name: string }>[];
  };
  buildings: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<Building3DProps>[];
  };
  labels: {
    type: "FeatureCollection";
    features: GeoJSONPointFeature<{
      id: string;
      name: string;
      short_name: string;
      category: string;
      priority: number;
      height: number;
    }>[];
  };
  entrances: {
    type: "FeatureCollection";
    features: GeoJSONPointFeature<Entrance3DProps>[];
  };
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ccw(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  return (
    ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  );
}

/**
 * Detects whether an active walking route passes through (or enters the ground floor of) a building polygon.
 * Used to render that 3D building at opacity 0.35 so the ground-floor walking route stays clearly visible.
 */
export function routePassesThroughRing(
  routePath: [number, number][] | null,
  ring: number[][]
): boolean {
  if (!routePath || routePath.length < 2 || !ring || ring.length < 4) {
    return false;
  }

  // Check intermediate points & segment midpoints inside polygon, or segment crossing polygon edges
  for (let i = 0; i < routePath.length; i++) {
    const [lat, lng] = routePath[i];
    if (pointInRing(lng, lat, ring)) {
      return true;
    }
  }

  for (let i = 0; i < routePath.length - 1; i++) {
    const [lat1, lng1] = routePath[i];
    const [lat2, lng2] = routePath[i + 1];

    // Midpoint check catches chords crossing inside the building
    if (pointInRing((lng1 + lng2) * 0.5, (lat1 + lat2) * 0.5, ring)) {
      return true;
    }

    // Segment-edge intersection check
    for (let j = 0; j < ring.length - 1; j++) {
      if (
        segmentsIntersect(
          lng1,
          lat1,
          lng2,
          lat2,
          ring[j][0],
          ring[j][1],
          ring[j + 1][0],
          ring[j + 1][1]
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function inferHeightFromNodeName(name: string, fallbackHeight: number): number {
  const floorMatch = name.match(/(\d+)\s*ชั้น/);
  if (floorMatch) {
    const floors = Number(floorMatch[1]);
    if (floors === 9) return 34;
    if (floors === 8) return 30;
    if (floors === 10) return 40;
    if (floors >= 1 && floors <= 20) {
      return floors * 4;
    }
  }
  return fallbackHeight;
}

function categoryColorForNode(node: MapNode): {
  category: Building3DProps["category"];
  color: string;
} {
  const info = classifyBuilding(node);
  if (info.badgeStyle.text === "#BE123C") {
    return { category: "er", color: "#E11D48" };
  }
  if (info.category === "er_opd") {
    return { category: "opd", color: "#2563EB" };
  }
  if (info.category === "diagnostic") {
    return { category: "diagnostic", color: "#0284C7" };
  }
  if (info.category === "maternal_child") {
    return { category: "maternal_child", color: "#059669" };
  }
  return { category: "specialty", color: "#0F766E" };
}

function createSyntheticBuildingPolygon(
  lat: number,
  lng: number,
  widthM = 28,
  depthM = 20,
  angleDeg = -24
): number[][] {
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const hw = widthM / 2;
  const hd = depthM / 2;
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
    [-hw, -hd],
  ];
  return corners.map(([lx, ly]) => {
    const rx = lx * cosA - ly * sinA;
    const ry = lx * sinA + ly * cosA;
    return [
      Number((lng + rx / mPerDegLng).toFixed(6)),
      Number((lat + ry / mPerDegLat).toFixed(6)),
    ];
  });
}

export interface BoundBuildingResult {
  features: GeoJSONPolygonFeature<Building3DProps>[];
  labelFeatures: GeoJSONPointFeature<BuildingLabelProps>[];
  nodeByFeatureId: Map<string, MapNode>;
  featureIdByNodeId: Map<number, string>;
  hasRouteThroughAnyBuilding: boolean;
}

/**
 * Spatially binds live PostgreSQL `map_nodes` (is_building = true) to the 3D Sakon Nakhon Hospital
 * footprints, computes zoom-prioritized label points for MapLibre Symbol Layers, and flags buildings
 * whose ground floor is crossed by the active walking route (`route_through: true` -> opacity 0.35).
 */
export function bindMapNodesTo3DBuildings(
  dataset: SakonHospital3DDataset,
  dbBuildings: MapNode[],
  targetNodeId: number | null,
  routePath: [number, number][] | null = null,
  forceTranslucent = false
): BoundBuildingResult {
  const clonedFeatures: GeoJSONPolygonFeature<Building3DProps>[] =
    dataset.buildings.features.map((f, idx) => ({
      ...f,
      id: idx + 1,
      properties: {
        ...f.properties,
        priority: f.properties.priority ?? 2,
        linked_node_id: null,
        is_target: false,
        route_through: false,
      },
    }));

  const nodeByFeatureId = new Map<string, MapNode>();
  const featureIdByNodeId = new Map<number, string>();
  const claimedFeatureIds = new Set<string>();

  for (const node of dbBuildings) {
    let matched: GeoJSONPolygonFeature<Building3DProps> | null = null;

    // 1. Exact Point-in-Polygon containment check
    for (const f of clonedFeatures) {
      if (claimedFeatureIds.has(f.properties.id)) continue;
      const ring = f.geometry.coordinates[0];
      if (ring && pointInRing(node.lng, node.lat, ring)) {
        matched = f;
        break;
      }
    }

    // 2. Fallback: nearest unclaimed building footprint within 32 meters
    if (!matched) {
      let bestDist = 32;
      for (const f of clonedFeatures) {
        if (claimedFeatureIds.has(f.properties.id)) continue;
        const d = calculateDistanceMeters(
          node.lat,
          node.lng,
          f.properties.center_lat,
          f.properties.center_lng
        );
        if (d < bestDist) {
          bestDist = d;
          matched = f;
        }
      }
    }

    const { category, color } = categoryColorForNode(node);

    if (matched) {
      claimedFeatureIds.add(matched.properties.id);
      matched.properties.name = node.name || matched.properties.name;
      // Preserve curated official wall-map short_name so extra DB suffixes (e.g. "(10 ชั้น)", "(8 ชั้น)")
      // never clutter the 3D map labels; only fall back to node.name if short_name is empty.
      if (!matched.properties.short_name && node.name) {
        matched.properties.short_name = node.name;
      }
      matched.properties.category = category;
      matched.properties.color = color;
      matched.properties.height = inferHeightFromNodeName(
        node.name || "",
        matched.properties.height
      );
      matched.properties.keywords = node.keywords || matched.properties.keywords;
      matched.properties.indoor_guide =
        node.indoor_guide || matched.properties.indoor_guide;
      matched.properties.linked_node_id = node.id;
      matched.properties.is_target = targetNodeId === node.id;

      nodeByFeatureId.set(matched.properties.id, node);
      featureIdByNodeId.set(node.id, matched.properties.id);
    } else {
      const synthId = `db-node-${node.id}`;
      const synthHeight = inferHeightFromNodeName(node.name || "", 16);
      const synthFeature: GeoJSONPolygonFeature<Building3DProps> = {
        type: "Feature",
        id: clonedFeatures.length + 1,
        properties: {
          id: synthId,
          name: node.name || `อาคาร #${node.id}`,
          short_name: node.name || `อาคาร #${node.id}`,
          category,
          levels: Math.max(1, Math.round(synthHeight / 4)),
          height: synthHeight,
          base_height: 0,
          priority: 1,
          keywords: node.keywords,
          indoor_guide: node.indoor_guide,
          color,
          source: "database",
          center_lng: node.lng,
          center_lat: node.lat,
          linked_node_id: node.id,
          is_target: targetNodeId === node.id,
          route_through: false,
        },
        geometry: {
          type: "Polygon",
          coordinates: [createSyntheticBuildingPolygon(node.lat, node.lng)],
        },
      };
      clonedFeatures.push(synthFeature);
      nodeByFeatureId.set(synthId, node);
      featureIdByNodeId.set(node.id, synthId);
    }
  }

  // Flag buildings crossed by the active route (or when user toggles translucent view)
  let hasRouteThroughAnyBuilding = false;
  for (const f of clonedFeatures) {
    const ring = f.geometry.coordinates[0];
    const crossed =
      forceTranslucent ||
      (routePath && routePath.length >= 2 && routePassesThroughRing(routePath, ring));
    if (crossed) {
      f.properties.route_through = true;
      if (routePath && routePath.length >= 2) {
        hasRouteThroughAnyBuilding = true;
      }
    }
  }

  // Generate GeoJSON point labels for MapLibre Symbol Layers (collision-avoided, zoom-tiered)
  const labelFeatures: GeoJSONPointFeature<BuildingLabelProps>[] =
    clonedFeatures.map((f) => {
      const p = f.properties;
      const isTarget = Boolean(p.is_target);
      return {
        type: "Feature",
        properties: {
          id: p.id,
          name: p.name,
          short_name: p.short_name,
          category: p.category,
          priority: isTarget ? 1 : p.priority,
          height: p.height,
          is_target: isTarget,
          linked_node_id: p.linked_node_id ?? null,
          sort_key: isTarget ? 0 : p.priority === 1 ? 10 : p.linked_node_id ? 20 : 30,
        },
        geometry: {
          type: "Point",
          coordinates: [p.center_lng, p.center_lat],
        },
      };
    });

  return {
    features: clonedFeatures,
    labelFeatures,
    nodeByFeatureId,
    featureIdByNodeId,
    hasRouteThroughAnyBuilding,
  };
}
