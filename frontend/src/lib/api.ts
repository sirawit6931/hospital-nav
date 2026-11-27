import axios from "axios";

export interface Department {
  id: number;
  node_id: number;
  name: string;
  floor: string;
  operating_hours: string;
  phone: string;
  keywords: string;
  created_at?: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  color_hex: string;
  badge_bg: string;
  sort_order: number;
  show_in_legend: boolean;
  created_at?: string;
}

export interface ServicePoint {
  id: number;
  node_id: number | null;
  type: string;
  name: string;
  description: string;
  phone: string;
  is_active: boolean;
  created_at?: string;
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  level: string;
  is_active: boolean;
  expires_at: string | null;
  created_at?: string;
}

export interface MapVersion {
  id: number;
  name: string;
  description: string;
  is_live: boolean;
  node_count: number;
  building_count: number;
  edge_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface MapNode {
  id: number;
  version_id?: number;
  name: string;
  is_building: boolean;
  building_code?: string;
  badge_label?: string;
  floor_range?: string;
  service_status?: "open" | "open_24h" | "maintenance" | string;
  category_id?: number | null;
  keywords: string;
  indoor_guide: string;
  image_url: string;
  image_urls?: string[];
  lat: number;
  lng: number;
  created_at?: string;
  departments?: Department[];
}

/**
 * Returns a deduplicated list of all building photo URLs, combining `image_urls`
 * with the legacy cover `image_url` fallback.
 */
export function getBuildingImages(node: Pick<MapNode, "image_url" | "image_urls">): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const cover = (node.image_url || "").trim();
  const list = Array.isArray(node.image_urls) ? node.image_urls : [];

  for (const raw of list) {
    const u = typeof raw === "string" ? raw.trim() : "";
    if (u && !seen.has(u)) {
      seen.add(u);
      result.push(u);
    }
  }
  if (cover && !seen.has(cover)) {
    result.unshift(cover);
  }
  return result;
}

export interface AuditLog {
  id: number;
  action_type: string;
  action_label: string;
  entity_type: string;
  entity_id: number;
  badge_text: string;
  target_title: string;
  summary: string;
  actor_name: string;
  before_json?: unknown;
  after_json?: unknown;
  is_rolled_back: boolean;
  created_at: string;
}

export interface MapEdge {
  id: number;
  version_id?: number;
  from_node: number;
  to_node: number;
  distance_m: number;
  instruction: string;
  is_wheelchair_friendly: boolean;
  is_active: boolean;
  is_covered?: boolean;
  is_indoor_passthrough?: boolean;
  closure_reason?: string;
}

export interface SurveyTrack {
  id: number;
  name: string;
  zone?: string;
  status?: "in_progress" | "completed" | string;
  color_hex?: string;
  points_json: [number, number][];
  created_at?: string;
}

export interface RouteEdgeSummary {
  id: number;
  from_node: number;
  to_node: number;
  distance_m: number;
  instruction: string;
  is_wheelchair_friendly: boolean;
  is_covered: boolean;
  is_indoor_passthrough: boolean;
}

export interface ClosedEdgeNotice {
  id: number;
  from_node: number;
  to_node: number;
  closure_reason: string;
}

export interface RouteResponse {
  path: [number, number][];
  total_distance_m: number;
  estimated_walk_min: number;
  target_building: MapNode;
  start_node?: MapNode;
  is_wheelchair_friendly?: boolean;
  has_covered_walkway?: boolean;
  has_indoor_passthrough?: boolean;
  route_edges?: RouteEdgeSummary[];
  closed_notices?: ClosedEdgeNotice[];
}

export interface LoginResponse {
  expires_at: string;
  remember_me: boolean;
  admin: {
    id: number;
    username: string;
  };
}

export type AdminMeResponse = LoginResponse;

export interface UploadResponse {
  url: string;
  image_url: string;
  filename: string;
}

export const api = axios.create({
  baseURL: "",
  timeout: 15000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? "";
    if (
      status === 401 &&
      url.includes("/api/admin/") &&
      !url.includes("/api/admin/login") &&
      !url.includes("/api/admin/me") &&
      !url.includes("/api/admin/logout")
    ) {
      if (
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/admin") &&
        !window.location.pathname.startsWith("/admin/login")
      ) {
        window.location.href = "/admin/login";
      }
    }
    return Promise.reject(error);
  }
);

export function extractApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const serverMsg = err.response?.data?.error;
    if (typeof serverMsg === "string" && serverMsg.trim().length > 0) {
      return serverMsg;
    }
    if (!err.response) {
      return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend ทำงานอยู่ที่พอร์ต 8080";
    }
  }
  return fallback;
}
