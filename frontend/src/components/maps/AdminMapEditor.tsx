"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  Box,
  Globe,
  Info,
  Layers,
  Map as MapIcon,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { MapEdge, MapNode, SurveyTrack } from "@/lib/api";
import {
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_URL,
  HOSPITAL_CENTER,
  HOSPITAL_DEFAULT_ZOOM,
  OSM_STREET_ATTRIBUTION,
  OSM_STREET_URL,
} from "@/lib/hospital";
import type { MapViewMode, SakonHospital3DDataset } from "@/lib/hospital3d";

const HOSPITAL_CAMPUS_CENTER: [number, number] = [17.1633, 104.1581];
const HOSPITAL_MAX_BOUNDS: [[number, number], [number, number]] = [
  [17.1606, 104.1551],
  [17.1656, 104.1609],
];
const OUTSIDE_MASK_RING: [number, number][] = [
  [-90, -180],
  [-90, 180],
  [90, 180],
  [90, -180],
];
const CAMPUS_MASK_COLOR = "#E8EEF3";

let cachedAdminCampusDataset: SakonHospital3DDataset | null = null;

export type AdminEditorMode =
  | "add_node"
  | "draw_path"
  | "connect_edge"
  | "toggle_edge"
  | "delete"
  | "customize_3d";

export interface DraftPathPoint {
  lat: number;
  lng: number;
  nodeId?: number | null;
  label?: string;
}

interface AdminMapEditorProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  mode: AdminEditorMode;
  nodes: MapNode[];
  edges: MapEdge[];
  surveys: SurveyTrack[];
  showSurveys: boolean;
  selectedSourceNodeId: number | null;
  draftPathPoints?: DraftPathPoint[];
  onMapClick: (lat: number, lng: number) => void;
  onNodeClick: (node: MapNode) => void;
  onEdgeClick: (edge: MapEdge) => void;
  splitTrackId?: number | null;
  onSplitTrackClick?: (trackId: number, lat: number, lng: number) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function createAdminNodeIcon(
  isBuilding: boolean,
  isSelectedSource: boolean,
  isDeleteMode: boolean
) {
  const size = isBuilding ? 24 : 16;
  const bg = isSelectedSource
    ? "#F59E0B"
    : isDeleteMode
    ? "#DC2626"
    : isBuilding
    ? "#0F766E"
    : "#1D4ED8";

  const ring = isSelectedSource
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:3px solid #F59E0B;opacity:0.85;"></span>`
    : "";

  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
        ${ring}
        <span style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(15,23,42,0.45);display:block;"></span>
      </div>
    `,
  });
}

function MapClickListener({
  enabled,
  onMapClick,
}: {
  enabled: boolean;
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (enabled) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

function MapAutoController({ resetTrigger }: { resetTrigger: number }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);

  useEffect(() => {
    if (resetTrigger > 0) {
      map.flyTo(HOSPITAL_CENTER, HOSPITAL_DEFAULT_ZOOM, { duration: 0.55 });
    }
  }, [map, resetTrigger]);

  return null;
}

export default function AdminMapEditor({
  mapViewMode,
  onChangeMapViewMode,
  mode,
  nodes,
  edges,
  surveys,
  showSurveys,
  selectedSourceNodeId,
  draftPathPoints = [],
  onMapClick,
  onNodeClick,
  onEdgeClick,
  splitTrackId = null,
  onSplitTrackClick,
  onRefresh,
  isRefreshing = false,
}: AdminMapEditorProps) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [campusDataset, setCampusDataset] =
    useState<SakonHospital3DDataset | null>(cachedAdminCampusDataset);
  const controlsPopoverRef = useRef<HTMLDivElement | null>(null);
  const legendPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (cachedAdminCampusDataset) {
      setCampusDataset(cachedAdminCampusDataset);
      return;
    }
    let cancelled = false;
    fetch("/data/sakon-hospital-3d.json")
      .then((res) => res.json())
      .then((data: SakonHospital3DDataset) => {
        cachedAdminCampusDataset = data;
        if (!cancelled) setCampusDataset(data);
      })
      .catch(() => {
        // Keep maxBounds fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const campusRingLatLng = useMemo<[number, number][] | null>(() => {
    const ring = campusDataset?.campus?.features?.[0]?.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) return null;
    return ring.map(([lng, lat]) => [lat, lng]);
  }, [campusDataset]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (controlsPopoverRef.current && !controlsPopoverRef.current.contains(target)) {
        setControlsOpen(false);
      }
      if (legendPopoverRef.current && !legendPopoverRef.current.contains(target)) {
        setLegendOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const nodeById = useMemo(() => {
    const map = new Map<number, MapNode>();
    for (const n of nodes) {
      map.set(n.id, n);
    }
    return map;
  }, [nodes]);

  const isStreet = mapViewMode === "street";

  return (
    <div className="relative w-full h-full bg-[#E8EEF3]">
      <MapContainer
        center={HOSPITAL_CAMPUS_CENTER || HOSPITAL_CENTER}
        zoom={HOSPITAL_DEFAULT_ZOOM}
        minZoom={16.5}
        maxZoom={20}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        maxBounds={HOSPITAL_MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ background: CAMPUS_MASK_COLOR }}
        className={`w-full h-full z-0 ${
          mode === "add_node" || mode === "draw_path" ? "cursor-crosshair" : ""
        }`}
      >
        {isStreet ? (
          <TileLayer
            key="admin-osm"
            url={OSM_STREET_URL}
            attribution={OSM_STREET_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={19}
          />
        ) : (
          <TileLayer
            key="admin-esri"
            url={ESRI_SATELLITE_URL}
            attribution={ESRI_SATELLITE_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={18}
          />
        )}

        {/* 100% Opaque Inverse Mask hiding everything outside Sakon Nakhon Hospital */}
        <Pane
          name="admin-campus-mask-pane"
          style={{ zIndex: 350, pointerEvents: "none" }}
        >
          {campusRingLatLng && (
            <Polygon
              positions={[OUTSIDE_MASK_RING, campusRingLatLng]}
              interactive={false}
              pathOptions={{
                stroke: false,
                fillColor: CAMPUS_MASK_COLOR,
                fillOpacity: 1,
                fillRule: "evenodd",
              }}
            />
          )}
        </Pane>

        {campusRingLatLng && (
          <Polygon
            positions={campusRingLatLng}
            interactive={false}
            pathOptions={{
              fill: false,
              color: isStreet ? "#0F766E" : "#14B8A6",
              weight: 2.8,
              opacity: 0.95,
              dashArray: "8 6",
            }}
          />
        )}

        <MapAutoController resetTrigger={resetTrigger} />

        <MapClickListener
          enabled={
            mode === "add_node" || mode === "draw_path" || splitTrackId !== null
          }
          onMapClick={(lat, lng) => {
            if (splitTrackId !== null) {
              onSplitTrackClick?.(splitTrackId, lat, lng);
              return;
            }
            onMapClick(lat, lng);
          }}
        />

        {/* Freeform Draft Path Preview (Mode: draw_path) */}
        {draftPathPoints.length >= 2 && (
          <Polyline
            positions={draftPathPoints.map((p) => [p.lat, p.lng])}
            pathOptions={{
              color: "#F97316",
              weight: 5.5,
              opacity: 0.95,
              dashArray: "8 6",
            }}
          />
        )}
        {draftPathPoints.map((pt, idx) => (
          <Marker
            key={`draft-pt-${idx}`}
            position={[pt.lat, pt.lng]}
            interactive={false}
            zIndexOffset={700}
            icon={L.divIcon({
              className: "",
              iconSize: [18, 18],
              iconAnchor: [9, 9],
              html: `<div style="width:18px;height:18px;border-radius:9999px;background:#F97316;border:2px solid #FFFFFF;color:#FFFFFF;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,0.4);">${idx + 1}</div>`,
            })}
          />
        ))}

        {/* Survey Tracks Overlay (Mode 5 - Per-track distinct colors + Split Track click) */}
        {showSurveys &&
          surveys.map((track) => {
            const pts = Array.isArray(track.points_json)
              ? track.points_json.filter(
                  (p) =>
                    Array.isArray(p) &&
                    p.length >= 2 &&
                    typeof p[0] === "number" &&
                    typeof p[1] === "number"
                )
              : [];
            if (pts.length < 2) return null;
            const isSplittingThis = splitTrackId === track.id;

            return (
              <Polyline
                key={`survey-${track.id}`}
                positions={pts}
                pathOptions={{
                  color: track.color_hex || "#F97316",
                  weight: isSplittingThis ? 8 : 5,
                  opacity: 0.92,
                  lineCap: "round",
                  lineJoin: "round",
                }}
                eventHandlers={
                  isSplittingThis
                    ? {
                        click: (e) => {
                          L.DomEvent.stopPropagation(e);
                          onSplitTrackClick?.(
                            track.id,
                            e.latlng.lat,
                            e.latlng.lng
                          );
                        },
                      }
                    : undefined
                }
              >
                <Tooltip sticky className="hospital-pin-label">
                  {track.name} ({pts.length} จุด)
                  {isSplittingThis ? " • คลิกเพื่อตัดแบ่งตรงนี้" : ""}
                </Tooltip>
              </Polyline>
            );
          })}

        {/* Map Edges (Active = Solid Sky/Teal, Inactive = Red Dashed) */}
        {edges.map((edge) => {
          const from = nodeById.get(edge.from_node);
          const to = nodeById.get(edge.to_node);
          if (!from || !to) return null;

          const isActive = edge.is_active;
          const color = isActive ? "#0EA5E9" : "#DC2626";

          return (
            <Polyline
              key={`edge-${edge.id}`}
              positions={[
                [from.lat, from.lng],
                [to.lat, to.lng],
              ]}
              pathOptions={{
                color,
                weight: mode === "toggle_edge" || mode === "delete" ? 7 : 5,
                opacity: isActive ? 0.95 : 0.9,
                dashArray: isActive ? undefined : "10 8",
                lineCap: "round",
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onEdgeClick(edge);
                },
              }}
            >
              <Tooltip sticky className="hospital-pin-label">
                เส้น #{edge.id} • {Math.round(edge.distance_m)} ม. •{" "}
                {isActive ? "เปิดใช้งาน" : "ปิดชั่วคราว"}
                {edge.instruction ? ` (${edge.instruction})` : ""}
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Map Nodes (Buildings + Waypoints) */}
        {nodes.map((node) => {
          const isSelectedSource = selectedSourceNodeId === node.id;
          const icon = createAdminNodeIcon(
            node.is_building,
            isSelectedSource,
            mode === "delete"
          );

          return (
            <Marker
              key={`node-${node.id}`}
              position={[node.lat, node.lng]}
              icon={icon}
              zIndexOffset={node.is_building ? 500 : 200}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onNodeClick(node);
                },
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -10]}
                className="hospital-pin-label"
              >
                #{node.id} {node.name || (node.is_building ? "อาคาร" : "จุดแยกทางเดิน")}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Top-Right Collapsible Layers Popover (collapsed by default) */}
      <div
        ref={controlsPopoverRef}
        className="absolute top-[70px] right-3 z-[400] flex flex-col items-end gap-2"
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => setControlsOpen((prev) => !prev)}
            title="ชั้นข้อมูลและการแสดงผลแผนที่"
            aria-label="ชั้นข้อมูลและการแสดงผลแผนที่"
            aria-expanded={controlsOpen}
            className={`w-10 h-10 rounded-xl border shadow-md flex items-center justify-center transition-colors cursor-pointer ${
              controlsOpen
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          {controlsOpen && (
            <div className="absolute top-0 right-12 w-60 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F172A]">
                  ชั้นข้อมูลและการแสดงผล
                </span>
                <button
                  type="button"
                  onClick={() => setControlsOpen(false)}
                  aria-label="ปิดแผงควบคุม"
                  className="w-6 h-6 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    onChangeMapViewMode("3d");
                    setControlsOpen(false);
                  }}
                  className={`min-h-[34px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    mapViewMode === "3d"
                      ? "bg-[#0F766E] text-white shadow-xs"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>3D</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeMapViewMode("satellite");
                    setControlsOpen(false);
                  }}
                  className={`min-h-[34px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    mapViewMode === "satellite"
                      ? "bg-[#0F766E] text-white shadow-xs"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>ดาวเทียม</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeMapViewMode("street");
                    setControlsOpen(false);
                  }}
                  className={`min-h-[34px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    mapViewMode === "street"
                      ? "bg-[#0F766E] text-white shadow-xs"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>ถนน</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setResetTrigger((n) => n + 1);
                    setControlsOpen(false);
                  }}
                  className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>รีเซ็ตมุมกล้อง</span>
                </button>
                {onRefresh && (
                  <button
                    type="button"
                    onClick={() => {
                      onRefresh();
                      setControlsOpen(false);
                    }}
                    disabled={isRefreshing}
                    className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                    />
                    <span>รีเฟรช</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom-Left Collapsible Legend ("คำอธิบายสี") — collapsed by default */}
      <div
        ref={legendPopoverRef}
        className="absolute bottom-4 left-3 z-[400]"
      >
        {legendOpen && (
          <div className="mb-2 w-56 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-lg p-3 space-y-2 text-xs font-semibold text-slate-700">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-[#0F172A] font-bold">คำอธิบายสีแผนที่</span>
              <button
                type="button"
                onClick={() => setLegendOpen(false)}
                aria-label="ปิดคำอธิบายสี"
                className="w-6 h-6 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#0F766E] inline-block shrink-0" />
                อาคาร (is_building)
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1D4ED8] inline-block shrink-0" />
                จุดแยกทางเดิน
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 h-1 bg-[#0EA5E9] inline-block rounded shrink-0" />
                เส้นทางเปิด
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 border-t-2 border-dashed border-[#DC2626] inline-block shrink-0" />
                เส้นทางปิดซ่อมแซม
              </span>
              {showSurveys && (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-1 bg-[#F97316] inline-block rounded shrink-0" />
                  Survey Track
                </span>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setLegendOpen((prev) => !prev)}
          title="คำอธิบายสี"
          aria-expanded={legendOpen}
          className={`h-9 px-3 rounded-xl border shadow-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
            legendOpen
              ? "bg-[#0F766E] border-[#0F766E] text-white"
              : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>คำอธิบายสี</span>
        </button>
      </div>
    </div>
  );
}
