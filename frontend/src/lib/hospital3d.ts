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
  is_wing?: boolean;
  parent_id?: string | null;
  width_m?: number;
  depth_m?: number;
  angle_deg?: number;
  center_lng: number;
  center_lat: number;
  linked_node_id?: number | null;
  is_target?: boolean;
  is_selected?: boolean;
  route_through?: boolean;
  user_inside?: boolean;
}

export interface Building3DOverride {
  id: string;
  name?: string;
  short_name?: string;
  center_lat: number;
  center_lng: number;
  width_m: number;
  depth_m: number;
  angle_deg: number;
  height: number;
  base_height: number;
  color: string;
  hidden?: boolean;
  linked_node_id?: number | null;
}

export interface Custom3DPart {
  id: string;
  parent_id?: string;
  name: string;
  short_name: string;
  is_wing: boolean;
  center_lat: number;
  center_lng: number;
  width_m: number;
  depth_m: number;
  angle_deg: number;
  height: number;
  base_height: number;
  color: string;
  linked_node_id?: number | null;
}

export interface Map3DOverridesPayload {
  overrides: Record<string, Building3DOverride>;
  custom_parts: Custom3DPart[];
}

export const EMPTY_MAP_3D_OVERRIDES: Map3DOverridesPayload = {
  overrides: {},
  custom_parts: [],
};

export const WALL_MAP_COLOR_PRESETS: { label: string; color: string }[] = [
  { label: "แดงฉุกเฉิน", color: "#A61B29" },
  { label: "เหลืองร่มธรรม", color: "#EAB308" },
  { label: "แดงเลือดหมูร่มเย็น", color: "#881337" },
  { label: "ฟ้าหัวใจฯ", color: "#4A83B4" },
  { label: "เขียวรังสีฯ", color: "#2E7D32" },
  { label: "เขียวศัลยกรรม", color: "#65A30D" },
  { label: "เขียวอมฟ้าวิเคราะห์", color: "#1F8A70" },
  { label: "น้ำเงินพัสดุ", color: "#2563EB" },
  { label: "น้ำตาลร่มโพธิ์", color: "#6D4C41" },
  { label: "ม่วงสวัสดิการ", color: "#7E3B6B" },
  { label: "ทองโบสถ์", color: "#D97706" },
  { label: "ขาวเทาอาคารทั่วไป", color: "#E2E8F0" },
];

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
  trees?: {
    type: "FeatureCollection";
    features: GeoJSONPolygonFeature<{
      id: string;
      base_height: number;
      height: number;
      color: string;
    }>[];
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

export function createRectBuildingRing(
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
  const hw = Math.max(2, widthM) / 2;
  const hd = Math.max(2, depthM) / 2;
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

function createSyntheticBuildingPolygon(
  lat: number,
  lng: number,
  widthM = 28,
  depthM = 20,
  angleDeg = -24
): number[][] {
  return createRectBuildingRing(lat, lng, widthM, depthM, angleDeg);
}

/**
 * Applies saved Admin 3D overrides (extrusion width/depth/angle/height/base_height/color/position)
 * and appends admin-created custom extruded wings or buildings.
 */
export function apply3DOverrides(
  dataset: SakonHospital3DDataset,
  payload: Map3DOverridesPayload | null | undefined
): SakonHospital3DDataset {
  if (!payload) return dataset;
  const overrides = payload.overrides || {};
  const customParts = payload.custom_parts || [];

  const updatedBuildings: GeoJSONPolygonFeature<Building3DProps>[] = [];
  for (const feat of dataset.buildings.features) {
    const ov = overrides[feat.properties.id];
    if (!ov) {
      updatedBuildings.push(feat);
      continue;
    }
    if (ov.hidden) {
      continue;
    }
    const nextLat = ov.center_lat ?? feat.properties.center_lat;
    const nextLng = ov.center_lng ?? feat.properties.center_lng;
    const nextW = ov.width_m ?? feat.properties.width_m ?? 28;
    const nextD = ov.depth_m ?? feat.properties.depth_m ?? 20;
    const nextAngle = ov.angle_deg ?? feat.properties.angle_deg ?? -24;

    updatedBuildings.push({
      ...feat,
      properties: {
        ...feat.properties,
        name: ov.name || feat.properties.name,
        short_name:
          ov.short_name !== undefined
            ? ov.short_name
            : feat.properties.short_name,
        center_lat: nextLat,
        center_lng: nextLng,
        width_m: nextW,
        depth_m: nextD,
        angle_deg: nextAngle,
        height: ov.height ?? feat.properties.height,
        base_height: ov.base_height ?? feat.properties.base_height ?? 0,
        levels: Math.max(1, Math.round((ov.height ?? feat.properties.height) / 4)),
        color: ov.color || feat.properties.color,
        linked_node_id:
          ov.linked_node_id !== undefined
            ? ov.linked_node_id
            : feat.properties.linked_node_id ?? null,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          createRectBuildingRing(nextLat, nextLng, nextW, nextD, nextAngle),
        ],
      },
    });
  }

  for (const part of customParts) {
    updatedBuildings.push({
      type: "Feature",
      properties: {
        id: part.id,
        name: part.name || "ส่วนยื่นอาคาร 3D",
        short_name: part.is_wing ? "" : part.short_name || part.name || "",
        category: "support",
        levels: Math.max(1, Math.round(part.height / 4)),
        height: part.height,
        base_height: part.base_height || 0,
        priority: part.is_wing ? 3 : 2,
        color: part.color || "#E2E8F0",
        source: "admin-custom-3d",
        is_wing: part.is_wing,
        parent_id: part.parent_id || null,
        width_m: part.width_m,
        depth_m: part.depth_m,
        angle_deg: part.angle_deg,
        center_lat: part.center_lat,
        center_lng: part.center_lng,
        linked_node_id: part.linked_node_id ?? null,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          createRectBuildingRing(
            part.center_lat,
            part.center_lng,
            part.width_m,
            part.depth_m,
            part.angle_deg
          ),
        ],
      },
    });
  }

  return {
    ...dataset,
    buildings: {
      type: "FeatureCollection",
      features: updatedBuildings,
    },
  };
}

export interface BoundBuildingResult {
  features: GeoJSONPolygonFeature<Building3DProps>[];
  labelFeatures: GeoJSONPointFeature<BuildingLabelProps>[];
  nodeByFeatureId: Map<string, MapNode>;
  featureIdByNodeId: Map<number, string>;
  hasRouteThroughAnyBuilding: boolean;
  userInsideBuildingName: string | null;
}

/**
 * Spatially binds live PostgreSQL `map_nodes` (is_building = true) to the 3D Sakon Nakhon Hospital
 * footprints, computes zoom-prioritized label points for MapLibre Symbol Layers, and flags buildings
 * as translucent (`route_through: true`) when crossed by the active route OR when the user's current
 * GPS position is inside that building (including all linked wings/roof tiers).
 */
export function bindMapNodesTo3DBuildings(
  dataset: SakonHospital3DDataset,
  dbBuildings: MapNode[],
  targetNodeId: number | null,
  routePath: [number, number][] | null = null,
  forceTranslucent = false,
  selectedBuildingId: string | null = null,
  userCoords: [number, number] | null = null
): BoundBuildingResult {
  const clonedFeatures: GeoJSONPolygonFeature<Building3DProps>[] =
    dataset.buildings.features.map((f, idx) => ({
      ...f,
      id: idx + 1,
      properties: {
        ...f.properties,
        priority: f.properties.priority ?? 2,
        linked_node_id: f.properties.linked_node_id ?? null,
        is_target: false,
        is_selected: selectedBuildingId === f.properties.id,
        route_through: false,
      },
    }));

  const nodeByFeatureId = new Map<string, MapNode>();
  const featureIdByNodeId = new Map<number, string>();
  const claimedFeatureIds = new Set<string>();
  const dbNodeById = new Map<number, MapNode>();
  for (const node of dbBuildings) {
    dbNodeById.set(node.id, node);
  }

  // 0. Honor explicit admin-assigned linked_node_id first (supports multi-block buildings & wings!)
  for (const f of clonedFeatures) {
    const explicitId = f.properties.linked_node_id;
    if (explicitId && dbNodeById.has(explicitId)) {
      const node = dbNodeById.get(explicitId)!;
      nodeByFeatureId.set(f.properties.id, node);
      if (!featureIdByNodeId.has(node.id)) {
        featureIdByNodeId.set(node.id, f.properties.id);
      }
      f.properties.is_target = targetNodeId === node.id;
      claimedFeatureIds.add(f.properties.id);
    }
  }

  for (const node of dbBuildings) {
    // Skip nodes already explicitly linked to one or more admin-customized 3D blocks
    if (featureIdByNodeId.has(node.id)) {
      continue;
    }
    let matched: GeoJSONPolygonFeature<Building3DProps> | null = null;

    // 1. Exact Point-in-Polygon containment check (skip architectural wings)
    for (const f of clonedFeatures) {
      if (f.properties.is_wing || claimedFeatureIds.has(f.properties.id)) continue;
      const ring = f.geometry.coordinates[0];
      if (ring && pointInRing(node.lng, node.lat, ring)) {
        matched = f;
        break;
      }
    }

    // 2. Fallback: nearest unclaimed main building footprint within 32 meters
    if (!matched) {
      let bestDist = 32;
      for (const f of clonedFeatures) {
        if (f.properties.is_wing || claimedFeatureIds.has(f.properties.id)) continue;
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
      // Preserve curated official wall-map short_name & authentic wall-map color
      if (!matched.properties.short_name && node.name) {
        matched.properties.short_name = node.name;
      }
      matched.properties.category = category;
      if (!matched.properties.color) {
        matched.properties.color = color;
      }
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
          width_m: 28,
          depth_m: 20,
          angle_deg: -24,
          center_lng: node.lng,
          center_lat: node.lat,
          linked_node_id: node.id,
          is_target: targetNodeId === node.id,
          is_selected: selectedBuildingId === synthId,
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

  // Flag buildings crossed by the active route, user walking inside, or X-Ray mode ON
  let hasRouteThroughAnyBuilding = false;
  let userInsideBuildingName: string | null = null;
  const userInsideGroupIds = new Set<string>();
  const userInsideLinkedNodeIds = new Set<number>();

  // Pass 1: detect which building/wing the user's current position is inside
  if (userCoords) {
    const [userLat, userLng] = userCoords;
    for (const f of clonedFeatures) {
      const ring = f.geometry.coordinates[0];
      if (ring && ring.length >= 4 && pointInRing(userLng, userLat, ring)) {
        f.properties.user_inside = true;
        userInsideGroupIds.add(f.properties.id);
        if (f.properties.parent_id) {
          userInsideGroupIds.add(f.properties.parent_id);
        }
        if (f.properties.linked_node_id) {
          userInsideLinkedNodeIds.add(f.properties.linked_node_id);
        }
        if (!userInsideBuildingName && f.properties.short_name) {
          userInsideBuildingName = f.properties.short_name;
        }
      }
    }
  }

  // Pass 2: propagate translucency to the entire multi-part building (main block + all wings/roof tiers)
  for (const f of clonedFeatures) {
    const ring = f.geometry.coordinates[0];
    const inUserGroup =
      Boolean(f.properties.user_inside) ||
      userInsideGroupIds.has(f.properties.id) ||
      Boolean(
        f.properties.parent_id && userInsideGroupIds.has(f.properties.parent_id)
      ) ||
      Boolean(
        f.properties.linked_node_id &&
          userInsideLinkedNodeIds.has(f.properties.linked_node_id)
      );

    if (inUserGroup) {
      f.properties.user_inside = true;
      if (!userInsideBuildingName && f.properties.short_name) {
        userInsideBuildingName = f.properties.short_name;
      }
    }

    const routeCrossed =
      Boolean(
        routePath &&
          routePath.length >= 2 &&
          routePassesThroughRing(routePath, ring)
      );

    if (forceTranslucent || inUserGroup || routeCrossed) {
      f.properties.route_through = true;
      if (routeCrossed) {
        hasRouteThroughAnyBuilding = true;
      }
    }
  }

  // Generate GeoJSON point labels for MapLibre Symbol Layers (skip architectural wings & empty labels)
  const labelFeatures: GeoJSONPointFeature<BuildingLabelProps>[] =
    clonedFeatures
      .filter((f) => !f.properties.is_wing && Boolean(f.properties.short_name))
      .map((f) => {
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
    userInsideBuildingName,
  };
}
