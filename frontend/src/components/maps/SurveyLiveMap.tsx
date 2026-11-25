"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
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

function FollowGpsController({
  coords,
}: {
  coords: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (coords) {
      map.panTo(coords, { animate: true });
    }
  }, [map, coords]);
  return null;
}

export default function SurveyLiveMap({
  currentCoords,
  accuracyMeters,
  trackPoints,
}: SurveyLiveMapProps) {
  const surveyorIcon = useMemo(() => createSurveyorIcon(), []);

  return (
    <MapContainer
      center={currentCoords || HOSPITAL_CENTER}
      zoom={HOSPITAL_DEFAULT_ZOOM + 1}
      maxZoom={21}
      className="w-full h-full z-0"
    >
      <TileLayer
        url={ESRI_SATELLITE_URL}
        attribution={ESRI_SATELLITE_ATTRIBUTION}
        maxZoom={21}
        maxNativeZoom={19}
      />

      <FollowGpsController coords={currentCoords} />

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
          <Marker position={currentCoords} icon={surveyorIcon} />
        </>
      )}
    </MapContainer>
  );
}
