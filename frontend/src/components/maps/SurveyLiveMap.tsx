"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  Circle,
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
  Layers,
  LocateFixed,
  Map as MapIcon,
  X,
} from "lucide-react";
import type { MapNode, SurveyTrack } from "@/lib/api";
import type { QuickWaypoint } from "@/lib/gpx";
import type { MapViewMode, SakonHospital3DDataset } from "@/lib/hospital3d";
import {
  buildDirectionalUserMarkerHTML,
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_URL,
  HOSPITAL_CENTER,
  HOSPITAL_DEFAULT_ZOOM,
  OSM_STREET_ATTRIBUTION,
  OSM_STREET_URL,
} from "@/lib/hospital";

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

let cachedSurveyCampusDataset: SakonHospital3DDataset | null = null;

interface SurveyLiveMapProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  currentCoords: [number, number] | null;
  userHeadingDeg?: number;
  accuracyMeters: number | null;
  trackPoints: [number, number][];
  quickWaypoints?: QuickWaypoint[];
  previewTrack?: SurveyTrack | null;
  pinnedNodes: MapNode[];
  draftPinCoords: [number, number] | null;
  focusCoords?: [number, number] | null;
  followGps: boolean;
  onChangeFollowGps: (follow: boolean) => void;
  onMapTapToAdjustPin: (lat: number, lng: number) => void;
}

function createSurveyorIcon(headingDeg: number) {
  return L.divIcon({
    className: "",
    iconSize: [64, 64],
    iconAnchor: [32, 32],
    html: buildDirectionalUserMarkerHTML(headingDeg, false, true),
  });
}

function createStartPinIcon() {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#16A34A;border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.45);"></span>`,
  });
}

function createQuickWaypointIcon() {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="display:block;width:18px;height:18px;border-radius:6px;background:#EA580C;border:2.5px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.4);"></span>`,
  });
}

function createSavedNodeIcon(isBuilding: boolean) {
  const size = isBuilding ? 18 : 11;
  const bg = isBuilding ? "#047857" : "#2563EB";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.38);"></span>`,
  });
}

function createDraftPinIcon() {
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `
      <div style="position:relative;width:26px;height:26px;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:-5px;border-radius:9999px;border:2.5px dashed #D97706;"></span>
        <span style="width:20px;height:20px;border-radius:9999px;background:#D97706;border:3px solid #FFFFFF;box-shadow:0 2px 8px rgba(15,23,42,0.45);display:block;"></span>
      </div>
    `,
  });
}

function MapBehaviorController({
  coords,
  followGps,
  focusCoords,
  previewTrack,
  onChangeFollowGps,
  onTap,
}: {
  coords: [number, number] | null;
  followGps: boolean;
  focusCoords?: [number, number] | null;
  previewTrack?: SurveyTrack | null;
  onChangeFollowGps: (follow: boolean) => void;
  onTap: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const initializedRef = useRef(false);

  // Auto-resize Leaflet map when container or window resizes (e.g. Admin Sidebar collapse)
  useEffect(() => {
    const container = map.getContainer();
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    if (!container || typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [map]);

  useMapEvents({
    dragstart() {
      onChangeFollowGps(false);
    },
    click(e) {
      onTap(
        Number(e.latlng.lat.toFixed(7)),
        Number(e.latlng.lng.toFixed(7))
      );
    },
  });

  useEffect(() => {
    if (coords && (followGps || !initializedRef.current)) {
      initializedRef.current = true;
      map.panTo(coords, { animate: true, duration: 0.35 });
    }
  }, [map, coords, followGps]);

  useEffect(() => {
    if (focusCoords) {
      map.flyTo(focusCoords, Math.max(map.getZoom(), 18.5), { duration: 0.55 });
    }
  }, [map, focusCoords]);

  useEffect(() => {
    if (
      previewTrack &&
      Array.isArray(previewTrack.points_json) &&
      previewTrack.points_json.length >= 2
    ) {
      const bounds = L.latLngBounds(previewTrack.points_json);
      map.fitBounds(bounds, { padding: [64, 90], maxZoom: 19, animate: true });
    }
  }, [map, previewTrack]);

  return null;
}

export default function SurveyLiveMap({
  mapViewMode,
  onChangeMapViewMode,
  currentCoords,
  userHeadingDeg = 0,
  accuracyMeters,
  trackPoints,
  quickWaypoints = [],
  previewTrack = null,
  pinnedNodes,
  draftPinCoords,
  focusCoords = null,
  followGps,
  onChangeFollowGps,
  onMapTapToAdjustPin,
}: SurveyLiveMapProps) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const [campusDataset, setCampusDataset] =
    useState<SakonHospital3DDataset | null>(cachedSurveyCampusDataset);
  const controlsPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (cachedSurveyCampusDataset) {
      setCampusDataset(cachedSurveyCampusDataset);
      return;
    }
    let cancelled = false;
    fetch("/data/sakon-hospital-3d.json")
      .then((res) => res.json())
      .then((data: SakonHospital3DDataset) => {
        cachedSurveyCampusDataset = data;
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
      if (
        controlsPopoverRef.current &&
        !controlsPopoverRef.current.contains(e.target as Node)
      ) {
        setControlsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  const roundedHeading = Math.round(userHeadingDeg);
  const surveyorIcon = useMemo(
    () => createSurveyorIcon(roundedHeading),
    [roundedHeading]
  );
  const startPinIcon = useMemo(() => createStartPinIcon(), []);
  const quickWptIcon = useMemo(() => createQuickWaypointIcon(), []);
  const buildingIcon = useMemo(() => createSavedNodeIcon(true), []);
  const waypointIcon = useMemo(() => createSavedNodeIcon(false), []);
  const draftPinIcon = useMemo(() => createDraftPinIcon(), []);

  const previewPts = useMemo<[number, number][]>(() => {
    if (!previewTrack || !Array.isArray(previewTrack.points_json)) return [];
    return previewTrack.points_json.filter(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
    );
  }, [previewTrack]);

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
        zoomControl={false}
        style={{ background: CAMPUS_MASK_COLOR }}
        className="w-full h-full z-0 cursor-crosshair"
      >
        {isStreet ? (
          <TileLayer
            key="survey-street"
            url={OSM_STREET_URL}
            attribution={OSM_STREET_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={19}
          />
        ) : (
          <TileLayer
            key="survey-satellite"
            url={ESRI_SATELLITE_URL}
            attribution={ESRI_SATELLITE_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={18}
          />
        )}

        {/* 100% Opaque Inverse Mask hiding everything outside Sakon Nakhon Hospital */}
        <Pane
          name="survey-campus-mask-pane"
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

        {/* Hospital Campus Perimeter Dashed Outline */}
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

        <MapBehaviorController
          coords={currentCoords}
          followGps={followGps}
          focusCoords={focusCoords}
          previewTrack={previewTrack}
          onChangeFollowGps={onChangeFollowGps}
          onTap={onMapTapToAdjustPin}
        />

        {/* Existing Hospital Buildings & Waypoints */}
        {pinnedNodes.map((node) => (
          <Marker
            key={`survey-node-${node.id}`}
            position={[node.lat, node.lng]}
            icon={node.is_building ? buildingIcon : waypointIcon}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              className="hospital-pin-label"
            >
              {node.name ||
                (node.is_building ? `อาคาร #${node.id}` : `จุด #${node.id}`)}
            </Tooltip>
          </Marker>
        ))}

        {/* Previewed Saved Survey Track (Sky Blue Dashed) */}
        {previewPts.length >= 2 && (
          <>
            <Polyline
              positions={previewPts}
              pathOptions={{
                color: "#FFFFFF",
                weight: 9,
                opacity: 0.85,
                lineCap: "round",
              }}
            />
            <Polyline
              positions={previewPts}
              pathOptions={{
                color: "#0284C7",
                weight: 5,
                opacity: 0.95,
                dashArray: "8 6",
                lineCap: "round",
              }}
            />
          </>
        )}

        {/* Active Recorded GPS Survey Track (White casing + Bold Orange Geo Tracker Trail) */}
        {trackPoints.length >= 2 && (
          <>
            <Polyline
              positions={trackPoints}
              pathOptions={{
                color: "#FFFFFF",
                weight: 10,
                opacity: 0.92,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <Polyline
              positions={trackPoints}
              pathOptions={{
                color: "#F97316",
                weight: 6,
                opacity: 0.98,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </>
        )}

        {/* Start Flag Dot of Active Track */}
        {trackPoints.length >= 1 && (
          <Marker
            position={trackPoints[0]}
            icon={startPinIcon}
            zIndexOffset={600}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              className="hospital-pin-label"
            >
              จุดเริ่มต้นรอยเดิน
            </Tooltip>
          </Marker>
        )}

        {/* Quick Waypoints Dropped During Current Recording */}
        {quickWaypoints.map((wpt) => (
          <Marker
            key={wpt.id}
            position={[wpt.lat, wpt.lng]}
            icon={quickWptIcon}
            zIndexOffset={650}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              className="hospital-pin-label"
            >
              {wpt.label}
            </Tooltip>
          </Marker>
        ))}

        {/* Manual Adjusted Pin Preview */}
        {draftPinCoords && (
          <Marker
            position={draftPinCoords}
            icon={draftPinIcon}
            zIndexOffset={900}
          >
            <Tooltip
              direction="top"
              offset={[0, -12]}
              permanent
              className="hospital-pin-label"
            >
              จุดที่เลือกบนแผนที่
            </Tooltip>
          </Marker>
        )}

        {/* Live Surveyor GPS Dot + Accuracy Halo */}
        {currentCoords && (
          <>
            {accuracyMeters !== null && accuracyMeters > 0 && (
              <Circle
                center={currentCoords}
                radius={Math.min(accuracyMeters, 80)}
                pathOptions={{
                  color: "#0F766E",
                  fillColor: "#14B8A6",
                  fillOpacity: 0.18,
                  weight: 1.5,
                }}
              />
            )}
            <Marker
              position={currentCoords}
              icon={surveyorIcon}
              zIndexOffset={800}
            />
          </>
        )}
      </MapContainer>

      {/* Right-Side Collapsible Layers Popover (3D / Satellite / Street) + Locate Me */}
      <div
        ref={controlsPopoverRef}
        className="absolute right-3 top-28 z-[420] flex flex-col items-end gap-2"
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => setControlsOpen((prev) => !prev)}
            title="ชั้นข้อมูลและการแสดงผลแผนที่"
            aria-label="ชั้นข้อมูลและการแสดงผลแผนที่"
            aria-expanded={controlsOpen}
            className={`w-11 h-11 rounded-2xl border shadow-lg flex items-center justify-center transition-colors cursor-pointer ${
              controlsOpen
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Layers className="w-5 h-5" />
          </button>

          {controlsOpen && (
            <div className="absolute top-0 right-13 w-64 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F172A]">
                  ชั้นข้อมูลและการแสดงผล
                </span>
                <button
                  type="button"
                  onClick={() => setControlsOpen(false)}
                  aria-label="ปิดแผงควบคุมแผนที่"
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
                  className={`min-h-[36px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
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
                  className={`min-h-[36px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
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
                  className={`min-h-[36px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                    mapViewMode === "street"
                      ? "bg-[#0F766E] text-white shadow-xs"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>ถนน</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onChangeFollowGps(true)}
          title="ดึงกล้องกลับมาที่ตำแหน่ง GPS ปัจจุบัน"
          aria-label="ตำแหน่งฉัน"
          className={`w-11 h-11 rounded-2xl border shadow-lg flex items-center justify-center transition-colors cursor-pointer ${
            followGps
              ? "bg-[#0F766E] border-[#0F766E] text-white"
              : "bg-white/95 backdrop-blur border-slate-200 text-[#0F766E] hover:bg-teal-50"
          }`}
        >
          <LocateFixed className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
