"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { MapNode } from "@/lib/api";
import {
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_URL,
  HOSPITAL_CENTER,
  HOSPITAL_DEFAULT_ZOOM,
} from "@/lib/hospital";

interface SurveyLiveMapProps {
  currentCoords: [number, number] | null;
  accuracyMeters: number | null;
  trackPoints: [number, number][];
  pinnedNodes: MapNode[];
  draftPinCoords: [number, number] | null;
  onMapTapToAdjustPin: (lat: number, lng: number) => void;
}

function createSurveyorIcon() {
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `
      <div class="gps-user-dot" style="width:22px;height:22px;border-radius:9999px;background:#0F766E;border:3px solid #FFFFFF;box-shadow:0 2px 10px rgba(15,118,110,0.6);"></div>
    `,
  });
}

function createSavedNodeIcon(isBuilding: boolean) {
  const size = isBuilding ? 20 : 12;
  const bg = isBuilding ? "#047857" : "#2563EB";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2.5px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.4);"></span>`,
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

function FollowGpsController({
  coords,
  disabled,
}: {
  coords: [number, number] | null;
  disabled: boolean;
}) {
  const map = useMap();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (coords && (!disabled || !initializedRef.current)) {
      initializedRef.current = true;
      map.panTo(coords, { animate: true });
    }
  }, [map, coords, disabled]);

  return null;
}

function TapToAdjustPin({
  onTap,
}: {
  onTap: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onTap(
        Number(e.latlng.lat.toFixed(7)),
        Number(e.latlng.lng.toFixed(7))
      );
    },
  });
  return null;
}

export default function SurveyLiveMap({
  currentCoords,
  accuracyMeters,
  trackPoints,
  pinnedNodes,
  draftPinCoords,
  onMapTapToAdjustPin,
}: SurveyLiveMapProps) {
  const surveyorIcon = useMemo(() => createSurveyorIcon(), []);
  const buildingIcon = useMemo(() => createSavedNodeIcon(true), []);
  const waypointIcon = useMemo(() => createSavedNodeIcon(false), []);
  const draftPinIcon = useMemo(() => createDraftPinIcon(), []);

  return (
    <MapContainer
      center={currentCoords || HOSPITAL_CENTER}
      zoom={HOSPITAL_DEFAULT_ZOOM + 1}
      maxZoom={20}
      zoomSnap={0.25}
      zoomDelta={0.5}
      wheelPxPerZoomLevel={120}
      className="w-full h-full z-0 cursor-crosshair"
    >
      <TileLayer
        url={ESRI_SATELLITE_URL}
        attribution={ESRI_SATELLITE_ATTRIBUTION}
        maxZoom={20}
        maxNativeZoom={18}
      />

      <FollowGpsController
        coords={currentCoords}
        disabled={Boolean(draftPinCoords)}
      />
      <TapToAdjustPin onTap={onMapTapToAdjustPin} />

      {/* Existing & Newly Pinned Hospital Buildings & Waypoints */}
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
            {node.name || (node.is_building ? `อาคาร #${node.id}` : `จุด #${node.id}`)}
          </Tooltip>
        </Marker>
      ))}

      {/* Active Recorded GPS Survey Track */}
      {trackPoints.length >= 2 && (
        <Polyline
          positions={trackPoints}
          pathOptions={{
            color: "#F97316",
            weight: 6,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      )}

      {/* Manual Adjusted Pin Preview (when field staff taps map to fine-tune building location) */}
      {draftPinCoords && (
        <Marker position={draftPinCoords} icon={draftPinIcon} zIndexOffset={900}>
          <Tooltip
            direction="top"
            offset={[0, -12]}
            permanent
            className="hospital-pin-label"
          >
            จุดที่จะปักตึก/หมุด
          </Tooltip>
        </Marker>
      )}

      {/* Live Surveyor GPS Dot + Accuracy Circle */}
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
          <Marker position={currentCoords} icon={surveyorIcon} zIndexOffset={700} />
        </>
      )}
    </MapContainer>
  );
}
