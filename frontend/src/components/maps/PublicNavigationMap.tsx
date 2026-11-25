"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  Compass,
  Crosshair,
  Layers,
  Loader2,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import type { MapNode, RouteResponse } from "@/lib/api";
import {
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_URL,
  HOSPITAL_CENTER,
  HOSPITAL_DEFAULT_ZOOM,
  OSM_STREET_ATTRIBUTION,
  OSM_STREET_URL,
  classifyBuilding,
} from "@/lib/hospital";

interface PublicNavigationMapProps {
  buildings: MapNode[];
  displayOriginCoords: [number, number];
  rawOriginCoords: [number, number];
  isSnappedToPath: boolean;
  isAutoRerouting: boolean;
  distanceToTargetMeters: number | null;
  focusedNode: MapNode | null;
  targetBuilding: MapNode | null;
  routeData: RouteResponse | null;
  mockGpsEnabled: boolean;
  isMockWalking: boolean;
  mockWalkProgress: number;
  onSelectBuilding: (building: MapNode) => void;
  onLocateMe: () => void;
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

function createUserOriginIcon(isMock: boolean) {
  const bg = isMock ? "#D97706" : "#0F766E";
  const inner = isMock ? "#FEF3C7" : "#CCFBF1";
  return L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `
      <div class="gps-user-dot" style="width:24px;height:24px;border-radius:9999px;background:${bg};border:3.5px solid #FFFFFF;box-shadow:0 2px 10px rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;">
        <span style="width:7px;height:7px;border-radius:9999px;background:${inner};"></span>
      </div>
    `,
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
  mockGpsEnabled,
}: {
  routePath: [number, number][] | null;
  focusedNode: MapNode | null;
  mockGpsEnabled: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (mockGpsEnabled) return;
    if (routePath && routePath.length >= 2) {
      const bounds = L.latLngBounds(routePath);
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 19, animate: true });
      return;
    }
    if (routePath && routePath.length === 1) {
      map.flyTo(routePath[0], 18, { duration: 0.6 });
    }
  }, [map, routePath, mockGpsEnabled]);

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
  buildings,
  displayOriginCoords,
  rawOriginCoords,
  isSnappedToPath,
  isAutoRerouting,
  distanceToTargetMeters,
  focusedNode,
  targetBuilding,
  routeData,
  mockGpsEnabled,
  isMockWalking,
  mockWalkProgress,
  onSelectBuilding,
  onLocateMe,
  onToggleMockGps,
  onMockMapClick,
  onToggleMockWalk,
  onChangeMockProgress,
  onResetMockWalk,
}: PublicNavigationMapProps) {
  const [mapStyle, setMapStyle] = useState<"satellite" | "street">("satellite");

  const userIcon = useMemo(
    () => createUserOriginIcon(mockGpsEnabled),
    [mockGpsEnabled]
  );
  const rawGhostIcon = useMemo(() => createRawGpsGhostIcon(), []);
  const targetIcon = useMemo(() => createPinIcon("#BE123C", 32, true), []);
  const routePath = routeData?.path ?? null;
  const hasRoutePath = Boolean(routePath && routePath.length >= 2);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={HOSPITAL_CENTER}
        zoom={HOSPITAL_DEFAULT_ZOOM}
        maxZoom={20}
        className={`w-full h-full z-0 ${
          mockGpsEnabled ? "cursor-crosshair" : ""
        }`}
        zoomControl={true}
      >
        {mapStyle === "satellite" ? (
          <TileLayer
            key="esri-satellite"
            url={ESRI_SATELLITE_URL}
            attribution={ESRI_SATELLITE_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={19}
          />
        ) : (
          <TileLayer
            key="osm-street"
            url={OSM_STREET_URL}
            attribution={OSM_STREET_ATTRIBUTION}
            maxZoom={20}
            maxNativeZoom={19}
          />
        )}

        <MapViewportController
          routePath={routePath}
          focusedNode={focusedNode}
          mockGpsEnabled={mockGpsEnabled}
        />

        <MockClickCapture
          enabled={mockGpsEnabled}
          onMapClick={onMockMapClick}
        />

        {/* Active Walking Route Polyline (Bright Sky Blue with crisp white casing) */}
        {routePath && routePath.length >= 2 && (
          <>
            <Polyline
              positions={routePath}
              pathOptions={{
                color: "#FFFFFF",
                weight: 10,
                opacity: 0.92,
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
        )}

        {/* In Mock Mode: Show faint dashed tether between raw tap and snapped position when Snap-to-Path is active */}
        {mockGpsEnabled && isSnappedToPath && (
          <>
            <Polyline
              positions={[rawOriginCoords, displayOriginCoords]}
              pathOptions={{
                color: "#F59E0B",
                weight: 2,
                dashArray: "4 4",
                opacity: 0.85,
              }}
            />
            <Marker
              position={rawOriginCoords}
              icon={rawGhostIcon}
              interactive={false}
            />
          </>
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
          const badge = classifyBuilding(building);
          const pinColor = isTarget
            ? "#BE123C"
            : badge.badgeStyle.text === "#BE123C"
            ? "#E11D48"
            : badge.badgeStyle.text === "#1D4ED8"
            ? "#2563EB"
            : "#0F766E";
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

      {/* Top-Center Live Status Pill (Auto-Reroute / Snap-to-Path / Remaining Distance) */}
      {(isAutoRerouting || (targetBuilding && distanceToTargetMeters !== null)) && (
        <div className="absolute top-3 left-14 right-32 md:right-36 z-[400] flex justify-center pointer-events-none">
          {isAutoRerouting ? (
            <div className="pointer-events-auto rounded-full bg-[#0F172A]/90 text-white px-3.5 py-1.5 shadow-md text-xs font-semibold flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span>ออกนอกเส้นทาง กำลังคำนวณเส้นทางใหม่...</span>
            </div>
          ) : (
            <div className="pointer-events-auto rounded-full bg-white/95 backdrop-blur border border-slate-200 px-3.5 py-1.5 shadow-md text-xs font-semibold text-[#0F172A] flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isSnappedToPath ? "bg-[#047857]" : "bg-[#0EA5E9]"
                }`}
              />
              <span>
                ห่างปลายทาง {Math.max(0, Math.round(distanceToTargetMeters ?? 0))} ม.
              </span>
              {isSnappedToPath && (
                <span className="hidden sm:inline text-[#047857] border-l border-slate-200 pl-2">
                  เกาะเส้นทางแล้ว
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top-right Map Controls: Layer Switch + Locate Me + Mock GPS Toggle */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2">
        <button
          type="button"
          onClick={() =>
            setMapStyle((prev) =>
              prev === "satellite" ? "street" : "satellite"
            )
          }
          className="min-h-[44px] px-3.5 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-slate-50 text-xs font-bold text-[#0F172A] flex items-center gap-2 cursor-pointer"
        >
          <Layers className="w-4 h-4 text-[#0F766E]" />
          <span>{mapStyle === "satellite" ? "แผนที่ถนน" : "ดาวเทียม"}</span>
        </button>

        <button
          type="button"
          onClick={onLocateMe}
          title="ตำแหน่งของฉัน"
          className="min-h-[44px] px-3.5 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-teal-50 text-xs font-bold text-[#0F766E] flex items-center gap-2 cursor-pointer"
        >
          <Crosshair className="w-4 h-4" />
          <span>ตำแหน่งฉัน</span>
        </button>

        <button
          type="button"
          onClick={onToggleMockGps}
          title="เปิด/ปิดโหมดจำลองพิกัด GPS สำหรับทดสอบ"
          className={`min-h-[44px] px-3.5 rounded-xl border shadow-md text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
            mockGpsEnabled
              ? "bg-amber-500 border-amber-600 text-white hover:bg-amber-600"
              : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-amber-50 hover:border-amber-300"
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>{mockGpsEnabled ? "ปิดจำลอง GPS" : "จำลอง GPS"}</span>
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

      {/* Bottom Legend Bar (Desktop) */}
      <div className="hidden md:flex absolute bottom-4 left-4 right-4 z-[400] pointer-events-none justify-between items-center">
        <div className="pointer-events-auto rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md px-3.5 py-2 flex items-center gap-4 text-xs font-semibold text-slate-700">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-3 h-3 rounded-full inline-block ${
                mockGpsEnabled ? "bg-amber-500" : "bg-[#0F766E]"
              }`}
            />
            {mockGpsEnabled ? "พิกัดจำลอง" : "จุดเริ่มต้น"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#BE123C] inline-block" />
            ปลายทาง
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-1.5 rounded-full bg-[#0EA5E9] inline-block" />
            เส้นทางเดิน
          </span>
        </div>

        <div className="pointer-events-auto rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md px-3.5 py-2 text-xs font-semibold text-[#0F766E]">
          {mockGpsEnabled
            ? "คลิกบนแผนที่เพื่อกำหนดตำแหน่งยืนจำลอง"
            : "แตะตึกบนแผนที่เพื่อเลือกปลายทาง"}
        </div>
      </div>
    </div>
  );
}
