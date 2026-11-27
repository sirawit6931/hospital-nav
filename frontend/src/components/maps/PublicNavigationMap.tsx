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
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  Box,
  Compass,
  Globe,
  Info,
  Layers,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import type { Category, MapNode, RouteResponse } from "@/lib/api";
import {
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_URL,
  HOSPITAL_CENTER,
  HOSPITAL_DEFAULT_ZOOM,
  OSM_STREET_ATTRIBUTION,
  OSM_STREET_URL,
  buildDirectionalUserMarkerHTML,
  classifyBuilding,
} from "@/lib/hospital";
import type { MapViewMode, SakonHospital3DDataset } from "@/lib/hospital3d";
import type { ActiveNavigationProgress } from "@/lib/navigation";
import ActiveNavigationOverlay from "@/components/ActiveNavigationOverlay";

// Tight pan/zoom bounds closely fitted around Sakon Nakhon Hospital (way/494975554: lat 17.1610..17.1652, lng 104.1556..104.1603)
const HOSPITAL_CAMPUS_CENTER: [number, number] = [17.1633, 104.1581];
const HOSPITAL_MAX_BOUNDS: [[number, number], [number, number]] = [
  [17.1606, 104.1551],
  [17.1656, 104.1609],
];
// Full-world outer ring so the 100% opaque inverse mask completely hides all tiles outside the hospital at any zoom/screen size
const OUTSIDE_MASK_RING: [number, number][] = [
  [-90, -180],
  [-90, 180],
  [90, 180],
  [90, -180],
];
const CAMPUS_MASK_COLOR = "#E8EEF3";

let cachedCampusDataset: SakonHospital3DDataset | null = null;

interface PublicNavigationMapProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  buildings: MapNode[];
  categories?: Category[];
  displayOriginCoords: [number, number];
  rawOriginCoords: [number, number];
  userHeadingDeg: number;
  gpsStatus: "idle" | "locating" | "ready" | "fallback";
  gpsAccuracyMeters: number | null;
  followUser: boolean;
  headingUpMode?: boolean;
  locateTrigger: number;
  isSnappedToPath: boolean;
  isAutoRerouting: boolean;
  distanceToTargetMeters: number | null;
  focusedNode: MapNode | null;
  targetBuilding: MapNode | null;
  routeData: RouteResponse | null;
  isNavigating: boolean;
  navProgress: ActiveNavigationProgress | null;
  voiceEnabled: boolean;
  isSimulatingWalk: boolean;
  recenterTrigger: number;
  mockGpsEnabled: boolean;
  isMockWalking: boolean;
  mockWalkProgress: number;
  onSelectBuilding: (building: MapNode) => void;
  onLocateMe: () => void;
  onChangeFollowUser: (follow: boolean) => void;
  onToggleHeadingUp?: () => void;
  onToggleVoice: () => void;
  onToggleSimulateWalk: () => void;
  onEndNavigation: () => void;
  onRecenterNavigation: () => void;
  onToggleMockGps: () => void;
  onMockMapClick: (lat: number, lng: number) => void;
  onToggleMockWalk: () => void;
  onChangeMockProgress: (progressPercent: number) => void;
  onResetMockWalk: () => void;
}

function createPinIcon(color: string, size = 28, isTarget = false) {
  const ring = isTarget
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:0.25;"></span>`
    : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
        ${ring}
        <span style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #FFFFFF;box-shadow:0 3px 10px rgba(15,23,42,0.38);display:flex;align-items:center;justify-content:center;">
          <span style="width:${Math.round(size * 0.34)}px;height:${Math.round(size * 0.34)}px;border-radius:9999px;background:#FFFFFF;"></span>
        </span>
      </div>
    `,
  });
}

function createUserOriginIcon(isMock: boolean, headingDeg: number) {
  return L.divIcon({
    className: "",
    iconSize: [64, 64],
    iconAnchor: [32, 32],
    html: buildDirectionalUserMarkerHTML(headingDeg, isMock, true),
  });
}

function createRawGpsGhostIcon() {
  return L.divIcon({
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:rgba(245,158,11,0.55);border:2px solid #FFFFFF;"></span>`,
  });
}

function MapViewportController({
  routePath,
  focusedNode,
  displayOriginCoords,
  followUser,
  locateTrigger,
  isNavigating,
  recenterTrigger,
  mockGpsEnabled,
  resetTrigger,
  onChangeFollowUser,
}: {
  routePath: [number, number][] | null;
  focusedNode: MapNode | null;
  displayOriginCoords: [number, number];
  followUser: boolean;
  locateTrigger: number;
  isNavigating: boolean;
  recenterTrigger: number;
  mockGpsEnabled: boolean;
  resetTrigger: number;
  onChangeFollowUser: (follow: boolean) => void;
}) {
  const map = useMap();

  useMapEvents({
    dragstart() {
      onChangeFollowUser(false);
    },
  });

  useEffect(() => {
    if (resetTrigger > 0) {
      map.flyTo(HOSPITAL_CAMPUS_CENTER, HOSPITAL_DEFAULT_ZOOM, {
        duration: 0.6,
      });
    }
  }, [map, resetTrigger]);

  useEffect(() => {
    if (locateTrigger > 0) {
      map.flyTo(displayOriginCoords, Math.max(map.getZoom(), 18.25), {
        duration: 0.6,
      });
    }
    // Fly explicitly when locate button is pressed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, locateTrigger]);

  useEffect(() => {
    if (isNavigating || recenterTrigger > 0) {
      if (isNavigating) {
        map.flyTo(displayOriginCoords, 19, { duration: 0.55 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isNavigating, recenterTrigger]);

  useEffect(() => {
    if (followUser) {
      map.panTo(displayOriginCoords, { animate: true, duration: 0.35 });
    }
  }, [map, displayOriginCoords, followUser]);

  useEffect(() => {
    if (mockGpsEnabled || isNavigating) return;
    if (routePath && routePath.length >= 2) {
      const bounds = L.latLngBounds(routePath);
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 19, animate: true });
      return;
    }
    if (routePath && routePath.length === 1) {
      map.flyTo(routePath[0], 18, { duration: 0.6 });
    }
  }, [map, routePath, mockGpsEnabled, isNavigating]);

  useEffect(() => {
    if (focusedNode) {
      map.flyTo([focusedNode.lat, focusedNode.lng], 18, { duration: 0.6 });
    }
  }, [map, focusedNode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

function MockClickCapture({
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

export default function PublicNavigationMap({
  mapViewMode,
  onChangeMapViewMode,
  buildings,
  categories = [],
  displayOriginCoords,
  rawOriginCoords,
  userHeadingDeg,
  gpsStatus,
  gpsAccuracyMeters,
  followUser,
  headingUpMode,
  locateTrigger,
  isSnappedToPath,
  isAutoRerouting,
  distanceToTargetMeters,
  focusedNode,
  targetBuilding,
  routeData,
  isNavigating,
  navProgress,
  voiceEnabled,
  isSimulatingWalk,
  recenterTrigger,
  mockGpsEnabled,
  isMockWalking,
  mockWalkProgress,
  onSelectBuilding,
  onLocateMe,
  onChangeFollowUser,
  onToggleHeadingUp,
  onToggleVoice,
  onToggleSimulateWalk,
  onEndNavigation,
  onRecenterNavigation,
  onToggleMockGps,
  onMockMapClick,
  onToggleMockWalk,
  onChangeMockProgress,
  onResetMockWalk,
}: PublicNavigationMapProps) {
  const [campusDataset, setCampusDataset] =
    useState<SakonHospital3DDataset | null>(cachedCampusDataset);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const controlsPopoverRef = useRef<HTMLDivElement | null>(null);
  const legendPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        controlsPopoverRef.current &&
        !controlsPopoverRef.current.contains(target)
      ) {
        setControlsOpen(false);
      }
      if (
        legendPopoverRef.current &&
        !legendPopoverRef.current.contains(target)
      ) {
        setLegendOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (cachedCampusDataset) {
      setCampusDataset(cachedCampusDataset);
      return;
    }
    let cancelled = false;
    fetch("/data/sakon-hospital-3d.json")
      .then((res) => res.json())
      .then((data: SakonHospital3DDataset) => {
        cachedCampusDataset = data;
        if (!cancelled) setCampusDataset(data);
      })
      .catch(() => {
        // Ignore gracefully; map bounds still restrict to hospital campus
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Convert GeoJSON [lng, lat] campus ring & covered walkways to Leaflet [lat, lng]
  const campusRingLatLng = useMemo<[number, number][] | null>(() => {
    const ring = campusDataset?.campus?.features?.[0]?.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) return null;
    return ring.map(([lng, lat]) => [lat, lng]);
  }, [campusDataset]);

  const coveredWalkwayLinesLatLng = useMemo<[number, number][][]>(() => {
    const feats = campusDataset?.covered_walkway_lines?.features;
    if (!feats) return [];
    return feats.map((f) =>
      f.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
    );
  }, [campusDataset]);

  const roundedHeading = Math.round(userHeadingDeg);
  const userIcon = useMemo(
    () => createUserOriginIcon(mockGpsEnabled, roundedHeading),
    [mockGpsEnabled, roundedHeading]
  );
  const rawGhostIcon = useMemo(() => createRawGpsGhostIcon(), []);
  const targetIcon = useMemo(() => createPinIcon("#BE123C", 32, true), []);
  const routePath = routeData?.path ?? null;
  const hasRoutePath = Boolean(routePath && routePath.length >= 2);
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
          mockGpsEnabled ? "cursor-crosshair" : ""
        }`}
        zoomControl={true}
      >
        {/* Layer 1 (Bottom - tilePane z-index 200): Base Satellite / Street Tiles */}
        {isStreet ? (
          <TileLayer
            key="osm-street"
            url={OSM_STREET_URL}
            attribution={OSM_STREET_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={19}
          />
        ) : (
          <TileLayer
            key="esri-satellite"
            url={ESRI_SATELLITE_URL}
            attribution={ESRI_SATELLITE_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={18}
          />
        )}

        <MapViewportController
          routePath={routePath}
          focusedNode={focusedNode}
          displayOriginCoords={displayOriginCoords}
          followUser={followUser}
          locateTrigger={locateTrigger}
          isNavigating={isNavigating}
          recenterTrigger={recenterTrigger}
          mockGpsEnabled={mockGpsEnabled}
          resetTrigger={resetTrigger}
          onChangeFollowUser={onChangeFollowUser}
        />

        <MockClickCapture
          enabled={mockGpsEnabled}
          onMapClick={onMockMapClick}
        />

        {/* Layer 2 (Middle - z-index 350): 100% Opaque Inverse Mask hiding everything outside Sakon Nakhon Hospital */}
        <Pane
          name="campus-mask-pane"
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

        {/* Layer 3 (Top Vectors - z-index 420): Campus Perimeter, Covered Walkways, Active Route & Mock Tether */}
        <Pane name="campus-vectors-pane" style={{ zIndex: 420 }}>
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

          {/* Covered Walkway Overlay Lines */}
          {coveredWalkwayLinesLatLng.map((line, idx) => (
            <Polyline
              key={`cw-2d-${idx}`}
              positions={line}
              interactive={false}
              pathOptions={{
                color: "#FB923C",
                weight: 4,
                opacity: 0.88,
                dashArray: "6 4",
                lineCap: "round",
              }}
            />
          ))}

          {/* Live GPS Accuracy Circle */}
          {!mockGpsEnabled &&
            gpsStatus === "ready" &&
            gpsAccuracyMeters !== null && (
              <Circle
                center={displayOriginCoords}
                radius={Math.max(3, Math.min(45, gpsAccuracyMeters))}
                interactive={false}
                pathOptions={{
                  color: "#0F766E",
                  weight: 1.5,
                  opacity: 0.45,
                  fillColor: "#14B8A6",
                  fillOpacity: 0.14,
                }}
              />
            )}

          {/* Active Walking Route Polyline (splits into faded gray passed + bright sky-blue remaining during Active Nav) */}
          {isNavigating && navProgress ? (
            <>
              {navProgress.passedPath.length >= 2 && (
                <Polyline
                  positions={navProgress.passedPath}
                  pathOptions={{
                    color: "#94A3B8",
                    weight: 6,
                    opacity: 0.85,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              )}
              {navProgress.remainingPath.length >= 2 && (
                <>
                  <Polyline
                    positions={navProgress.remainingPath}
                    pathOptions={{
                      color: "#FFFFFF",
                      weight: 10,
                      opacity: 0.94,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                  <Polyline
                    positions={navProgress.remainingPath}
                    pathOptions={{
                      color: "#0EA5E9",
                      weight: 6,
                      opacity: 1,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                </>
              )}
            </>
          ) : (
            routePath &&
            routePath.length >= 2 && (
              <>
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: "#FFFFFF",
                    weight: 10,
                    opacity: 0.94,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: "#0EA5E9",
                    weight: 6,
                    opacity: 1,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              </>
            )
          )}

          {/* In Mock Mode: Show dashed tether between raw tap and snapped position when Snap-to-Path is active */}
          {mockGpsEnabled && isSnappedToPath && (
            <Polyline
              positions={[rawOriginCoords, displayOriginCoords]}
              pathOptions={{
                color: "#F59E0B",
                weight: 2.5,
                dashArray: "4 4",
                opacity: 0.9,
              }}
            />
          )}
        </Pane>

        {/* Layer 4 (Top Markers - markerPane z-index 600): Raw Ghost Pin, Directional User Triangle & Building Pins */}
        {mockGpsEnabled && isSnappedToPath && (
          <Marker
            position={rawOriginCoords}
            icon={rawGhostIcon}
            interactive={false}
          />
        )}

        {/* User / Starting Origin Marker (Snapped onto Polyline when within 15m) */}
        <Marker
          position={displayOriginCoords}
          icon={userIcon}
          zIndexOffset={600}
        >
          <Tooltip
            direction="top"
            offset={[0, -14]}
            className="hospital-pin-label"
          >
            {mockGpsEnabled
              ? isSnappedToPath
                ? "พิกัดจำลอง (เกาะเส้นทาง)"
                : "พิกัดจำลอง (Mock GPS)"
              : isSnappedToPath
              ? "ตำแหน่งของคุณ (เกาะเส้นทาง)"
              : "จุดเริ่มต้น / ตำแหน่งของคุณ"}
          </Tooltip>
        </Marker>

        {/* Hospital Building Pins */}
        {buildings.map((building) => {
          const isTarget = targetBuilding?.id === building.id;
          const badge = classifyBuilding(building, categories);
          const pinColor = isTarget ? "#BE123C" : badge.accentColor || "#0F766E";
          const icon = isTarget
            ? targetIcon
            : createPinIcon(pinColor, 26, false);

          return (
            <Marker
              key={`bldg-${building.id}`}
              position={[building.lat, building.lng]}
              icon={icon}
              zIndexOffset={isTarget ? 1000 : 100}
              eventHandlers={{
                click: (e) => {
                  if (mockGpsEnabled) {
                    // Allow clicking near a building in Mock mode to test Arrival Detection directly
                    L.DomEvent.stopPropagation(e);
                    onMockMapClick(building.lat, building.lng);
                    return;
                  }
                  onSelectBuilding(building);
                },
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -14]}
                permanent={isTarget}
                className="hospital-pin-label"
              >
                {building.name}
              </Tooltip>
              {!mockGpsEnabled && (
                <Popup>
                  <div className="min-w-[190px] space-y-2">
                    <div className="font-heading font-bold text-sm text-[#0F172A]">
                      {building.name}
                    </div>
                    {building.keywords && (
                      <p className="text-xs text-slate-600 line-clamp-2">
                        {building.keywords}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectBuilding(building)}
                      className="w-full min-h-[38px] px-3 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>นำทางไปอาคารนี้</span>
                    </button>
                  </div>
                </Popup>
              )}
            </Marker>
          );
        })}
      </MapContainer>

      {/* Google-Maps-Style Active Turn-by-Turn Navigation HUD */}
      {isNavigating && navProgress && targetBuilding && (
        <ActiveNavigationOverlay
          targetName={routeData?.target_building?.name || targetBuilding.name}
          navProgress={navProgress}
          isAutoRerouting={isAutoRerouting}
          followUser={followUser}
          voiceEnabled={voiceEnabled}
          isSimulatingWalk={isSimulatingWalk}
          onRecenter={onRecenterNavigation}
          onToggleVoice={onToggleVoice}
          onToggleSimulateWalk={onToggleSimulateWalk}
          onEndNavigation={onEndNavigation}
        />
      )}

      {/* Top-Center Compact 1-Line Navigation Status Pill (hidden during Active Navigation) */}
      {!isNavigating &&
        (isAutoRerouting ||
          (targetBuilding && routeData && distanceToTargetMeters !== null)) && (
        <div className="absolute top-3 left-14 right-16 z-[400] flex justify-start sm:justify-center pointer-events-none">
          {isAutoRerouting ? (
            <div className="pointer-events-auto rounded-full bg-[#0F172A]/90 text-white px-3 py-1.5 shadow-sm text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 shrink-0" />
              <span>กำลังคำนวณเส้นทางใหม่...</span>
            </div>
          ) : (
            <div className="pointer-events-auto rounded-full bg-white/95 backdrop-blur border border-slate-200 px-3 py-1.5 shadow-sm text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 whitespace-nowrap max-w-full truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isSnappedToPath ? "bg-[#047857]" : "bg-[#0EA5E9]"
                }`}
              />
              <span>
                ห่างปลายทาง{" "}
                {Math.max(0, Math.round(distanceToTargetMeters ?? 0))} ม.
              </span>
              {isSnappedToPath && (
                <span className="hidden sm:inline text-[#047857] border-l border-slate-200 pl-1.5">
                  เกาะเส้นทางแล้ว
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top-Right Collapsible Map Controls (shifts below Top Turn Banner during Active Navigation) */}
      <div
        ref={controlsPopoverRef}
        className={`absolute right-3 z-[410] flex flex-col items-end gap-2 ${
          isNavigating ? "top-36 sm:top-32" : "top-3"
        }`}
      >
        {/* 1) Layers & Display Settings Popover Trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setControlsOpen((prev) => !prev)}
            title="ชั้นข้อมูลและการแสดงผล"
            aria-label="ชั้นข้อมูลและการแสดงผล"
            aria-expanded={controlsOpen}
            className={`w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors cursor-pointer ${
              controlsOpen || mockGpsEnabled
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          {controlsOpen && (
            <div className="absolute top-0 right-12 w-64 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-lg p-3 space-y-3">
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

              {/* Map Mode Switcher */}
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

              {/* Quick Actions */}
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

                <button
                  type="button"
                  onClick={() => {
                    onToggleMockGps();
                    setControlsOpen(false);
                  }}
                  className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    mockGpsEnabled
                      ? "bg-amber-500 border-amber-600 text-white"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-amber-50"
                  }`}
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>{mockGpsEnabled ? "ปิดจำลอง" : "จำลอง GPS"}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2) Locate Me (40x40px) */}
        <button
          type="button"
          onClick={onLocateMe}
          title={
            followUser && gpsAccuracyMeters !== null && gpsStatus === "ready"
              ? `ตำแหน่งฉัน (กำลังติดตาม GPS ±${gpsAccuracyMeters} ม.)`
              : "ตำแหน่งฉัน"
          }
          aria-label="ตำแหน่งฉัน"
          className={`w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors cursor-pointer ${
            followUser
              ? "bg-[#0F766E] border-[#0F766E] text-white"
              : "bg-white/95 backdrop-blur border-slate-200 text-[#0F766E] hover:bg-teal-50"
          }`}
        >
          <LocateFixed className="w-4 h-4" />
        </button>

        {/* 3) Heading-Up Mode (switches to 3D heading-up when toggled) */}
        <button
          type="button"
          onClick={() => {
            onToggleHeadingUp?.();
            onChangeMapViewMode("3d");
          }}
          title="หมุนแผนที่ตามทิศ (โหมด 3D)"
          aria-label="หมุนตามทิศ"
          className={`w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors cursor-pointer ${
            headingUpMode && followUser
              ? "bg-[#0F766E] border-[#0F766E] text-white"
              : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Compass className="w-4 h-4" />
        </button>
      </div>

      {/* Floating Mock GPS Simulator Bar (appears when Mock GPS mode is ON) */}
      {mockGpsEnabled && (
        <div className="absolute bottom-28 md:bottom-16 left-3 right-3 md:left-4 md:right-4 z-[420] flex justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-lg w-full rounded-2xl bg-white/96 backdrop-blur border border-amber-300 shadow-xl px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                <Compass className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  โหมดจำลองพิกัด (คลิกบนแผนที่เพื่อวางจุดยืน หรือจำลองการเดิน)
                </span>
              </div>
              <button
                type="button"
                onClick={onToggleMockGps}
                aria-label="ปิดโหมดจำลองพิกัด"
                className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {hasRoutePath ? (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onToggleMockWalk}
                  className="min-h-[40px] px-3 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  {isMockWalking ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>หยุดเดิน</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>เดินตามเส้นทาง</span>
                    </>
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(mockWalkProgress)}
                  onChange={(e) => onChangeMockProgress(Number(e.target.value))}
                  aria-label="เลื่อนตำแหน่งจำลองตามเส้นทาง"
                  className="flex-1 accent-[#0F766E] cursor-pointer"
                />

                <span className="text-xs font-bold text-slate-700 w-9 text-right tabular-nums">
                  {Math.round(mockWalkProgress)}%
                </span>

                <button
                  type="button"
                  onClick={onResetMockWalk}
                  title="รีเซ็ตไปจุดเริ่มต้นเส้นทาง"
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                เลือกอาคารปลายทางก่อน เพื่อใช้งานปุ่มจำลองเดินตามเส้นทาง (หรือคลิกจุดบนแผนที่เพื่อตั้งจุดยืนจำลองได้เลย)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom-Left Collapsible Legend Button ("คำอธิบายสี") — hidden during Active Navigation */}
      {!isNavigating && (
      <div
        ref={legendPopoverRef}
        className="absolute bottom-32 md:bottom-4 left-3 md:left-4 z-[400]"
      >
        {legendOpen && (
          <div className="mb-2 w-60 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-lg p-3 space-y-2 text-xs font-semibold text-slate-700">
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
              {categories
                .filter((c) => c.show_in_legend)
                .map((cat) => (
                  <span
                    key={`legend-2d-${cat.id}`}
                    className="flex items-center gap-2"
                  >
                    <span
                      className="w-3 h-3 rounded-full inline-block shrink-0 border border-black/10"
                      style={{ backgroundColor: cat.color_hex }}
                    />
                    <span className="truncate">{cat.name}</span>
                  </span>
                ))}
              <span className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <span
                  className={`w-3 h-3 rounded-full inline-block shrink-0 ${
                    mockGpsEnabled ? "bg-amber-500" : "bg-[#0F766E]"
                  }`}
                />
                {mockGpsEnabled ? "พิกัดจำลอง" : "จุดเริ่มต้น"}
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#BE123C] inline-block shrink-0" />
                ปลายทาง
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 border-t-2 border-dashed border-[#0F766E] inline-block shrink-0" />
                ขอบเขต รพ.สกลนคร
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 border-t-2 border-dashed border-[#FB923C] inline-block shrink-0" />
                ทางเชื่อมมีหลังคา
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 h-1.5 rounded-full bg-[#0EA5E9] inline-block shrink-0" />
                เส้นทางเดิน
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setLegendOpen((prev) => !prev)}
          title="คำอธิบายสี"
          aria-expanded={legendOpen}
          className={`h-9 px-3 rounded-xl border shadow-sm text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
            legendOpen
              ? "bg-[#0F766E] border-[#0F766E] text-white"
              : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>คำอธิบายสี</span>
        </button>
      </div>
      )}
    </div>
  );
}
