import axios from "axios";

export const ADMIN_TOKEN_KEY = "admin_token";

export interface MapNode {
  id: number;
  name: string;
  is_building: boolean;
  keywords: string;
  indoor_guide: string;
  image_url: string;
  lat: number;
  lng: number;
  created_at?: string;
}

export interface MapEdge {
  id: number;
  from_node: number;
  to_node: number;
  distance_m: number;
  instruction: string;
  is_wheelchair_friendly: boolean;
  is_active: boolean;
}

export interface SurveyTrack {
  id: number;
  name: string;
  points_json: [number, number][];
  created_at?: string;
}

export interface RouteResponse {
  path: [number, number][];
  total_distance_m: number;
  estimated_walk_min: number;
  target_building: MapNode;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  admin: {
    id: number;
    username: string;
  };
}

export interface UploadResponse {
  url: string;
  image_url: string;
  filename: string;
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export const api = axios.create({
  baseURL: "",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? "";
    if (
      status === 401 &&
      url.includes("/api/admin/") &&
      !url.includes("/api/admin/login")
    ) {
      clearAdminToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/admin/login")) {
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
