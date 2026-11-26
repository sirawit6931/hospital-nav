"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import { Box, Globe, Map as MapIcon } from "lucide-react";
import type { MapEdge, MapNode, SurveyTrack } from "@/lib/api";
import {
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_URL,
  HOSPITAL_CENTER,
  HOSPITAL_DEFAULT_ZOOM,
  OSM_STREET_ATTRIBUTION,
  OSM_STREET_URL,
} from "@/lib/hospital";
import type { MapViewMode } from "@/lib/hospital3d";

export type AdminEditorMode =
  | "add_node"
  | "connect_edge"
  | "toggle_edge"
  | "delete";

interface AdminMapEditorProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  mode: AdminEditorMode;
  nodes: MapNode[];
  edges: MapEdge[];
  surveys: SurveyTrack[];
  showSurveys: boolean;
  selectedSourceNodeId: number | null;
  onMapClick: (lat: number, lng: number) => void;
  onNodeClick: (node: MapNode) => void;
  onEdgeClick: (edge: MapEdge) => void;
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

export default function AdminMapEditor({
  mapViewMode,
  onChangeMapViewMode,
  mode,
  nodes,
  edges,
  surveys,
  showSurveys,
  selectedSourceNodeId,
  onMapClick,
  onNodeClick,
  onEdgeClick,
}: AdminMapEditorProps) {
  const nodeById = useMemo(() => {
    const map = new Map<number, MapNode>();
    for (const n of nodes) {
      map.set(n.id, n);
    }
    return map;
  }, [nodes]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={HOSPITAL_CENTER}
        zoom={HOSPITAL_DEFAULT_ZOOM}
        maxZoom={20}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        className={`w-full h-full z-0 ${
          mode === "add_node" ? "cursor-crosshair" : ""
        }`}
      >
        {mapViewMode === "street" ? (
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

        <MapClickListener
          enabled={mode === "add_node"}
          onMapClick={onMapClick}
        />

        {/* Survey Tracks Overlay (Mode 5 - Orange Polylines) */}
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

            return (
              <Polyline
                key={`survey-${track.id}`}
                positions={pts}
                pathOptions={{
                  color: "#F97316",
                  weight: 5,
                  opacity: 0.9,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              >
                <Tooltip sticky className="hospital-pin-label">
                  รอยเดินสำรวจ: {track.name} ({pts.length} จุด)
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

      {/* 3-Mode Map Switcher */}
      <div
        role="group"
        aria-label="เลือกโหมดแผนที่ผู้ดูแล"
        className="absolute top-3 right-3 z-[400] inline-flex items-center p-1 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md"
      >
        <button
          type="button"
          onClick={() => onChangeMapViewMode("3d")}
          className={`min-h-[38px] px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
            mapViewMode === "3d"
              ? "bg-[#0F766E] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>แผนที่ 3D</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeMapViewMode("satellite")}
          className={`min-h-[38px] px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
            mapViewMode === "satellite"
              ? "bg-[#0F766E] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>ดาวเทียม</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeMapViewMode("street")}
          className={`min-h-[38px] px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
            mapViewMode === "street"
              ? "bg-[#0F766E] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <MapIcon className="w-3.5 h-3.5" />
          <span>แผนที่ถนน</span>
        </button>
      </div>

      {/* Bottom Legend */}
      <div className="absolute bottom-4 left-4 z-[400] rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md px-3.5 py-2 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-700">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#0F766E] inline-block" />
          อาคาร (is_building)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#1D4ED8] inline-block" />
          จุดแยกทางเดิน
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-1 bg-[#0EA5E9] inline-block rounded" />
          เส้นทางเปิด
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-[#DC2626] inline-block" />
          เส้นทางปิดซ่อมแซม
        </span>
        {showSurveys && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-1 bg-[#F97316] inline-block rounded" />
            Survey Track
          </span>
        )}
      </div>
    </div>
  );
}
