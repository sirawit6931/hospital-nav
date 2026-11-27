"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  Box,
  Eye,
  Globe,
  Layers,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  X,
} from "lucide-react";
import type { MapNode, SurveyTrack } from "@/lib/api";
import type { QuickWaypoint } from "@/lib/gpx";
import {
  buildDirectionalUserMarkerHTML,
  createGeoJsonCircle,
  HOSPITAL_CENTER,
} from "@/lib/hospital";
import {
  apply3DOverrides,
  bindMapNodesTo3DBuildings,
  type Map3DOverridesPayload,
  type MapViewMode,
  type SakonHospital3DDataset,
} from "@/lib/hospital3d";

interface SurveyLive3DMapProps {
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

const DEFAULT_3D_CENTER: [number, number] = [
  HOSPITAL_CENTER[1],
  HOSPITAL_CENTER[0],
];
const DEFAULT_3D_ZOOM = 17.5;
const DEFAULT_3D_PITCH = 50;
const DEFAULT_3D_BEARING = -18;
const MAPLIBRE_THAI_GLYPHS_URL =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

let cachedSurvey3DDataset: SakonHospital3DDataset | null = null;

export default function SurveyLive3DMap({
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
}: SurveyLive3DMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);
  const nodeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const wptMarkersRef = useRef<maplibregl.Marker[]>([]);
  const controlsPopoverRef = useRef<HTMLDivElement | null>(null);
  const initializedGpsRef = useRef(false);

  const [dataset, setDataset] = useState<SakonHospital3DDataset | null>(
    cachedSurvey3DDataset
  );
  const [overrides3D, setOverrides3D] = useState<Map3DOverridesPayload | null>(
    null
  );
  const [mapReady, setMapReady] = useState(false);
  const [isTilted, setIsTilted] = useState(true);
  const [translucentBuildings, setTranslucentBuildings] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  // Close Layers Popover on outside click
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

  const onTapRef = useRef(onMapTapToAdjustPin);
  const onFollowRef = useRef(onChangeFollowGps);

  useEffect(() => {
    onTapRef.current = onMapTapToAdjustPin;
  }, [onMapTapToAdjustPin]);

  useEffect(() => {
    onFollowRef.current = onChangeFollowGps;
  }, [onChangeFollowGps]);

  // Load 3D hospital dataset + saved 3D overrides
  useEffect(() => {
    let cancelled = false;
    if (cachedSurvey3DDataset) {
      setDataset(cachedSurvey3DDataset);
    } else {
      fetch("/data/sakon-hospital-3d.json")
        .then((res) => res.json())
        .then((data: SakonHospital3DDataset) => {
          cachedSurvey3DDataset = data;
          if (!cancelled) setDataset(data);
        })
        .catch(() => {
          // Graceful fallback
        });
    }

    fetch("/api/map-3d-overrides", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((ov: Map3DOverridesPayload | null) => {
        if (!cancelled && ov) setOverrides3D(ov);
      })
      .catch(() => {
        // Optional overrides
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const boundBuildings = useMemo(() => {
    if (!dataset) return null;
    const effectiveDataset = apply3DOverrides(dataset, overrides3D);
    return bindMapNodesTo3DBuildings(
      effectiveDataset,
      pinnedNodes.filter((n) => n.is_building),
      null,
      trackPoints.length >= 2 ? trackPoints : null,
      translucentBuildings,
      null,
      currentCoords
    );
  }, [
    dataset,
    overrides3D,
    pinnedNodes,
    trackPoints,
    translucentBuildings,
    currentCoords,
  ]);

  // Auto-resize MapLibre canvas on container resize or window resize (e.g. Admin Sidebar collapse)
  useEffect(() => {
    const el = containerRef.current;
    const onResize = () => mapRef.current?.resize();
    window.addEventListener("resize", onResize);
    if (!el || typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Initialize MapLibre 3D Map
  useEffect(() => {
    if (!containerRef.current || !dataset || mapRef.current) return;

    maplibregl.setWorkerUrl("/maplibre-gl-csp-worker.js");

    const initialCenter: [number, number] = currentCoords
      ? [currentCoords[1], currentCoords[0]]
      : dataset.meta.center || DEFAULT_3D_CENTER;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: initialCenter,
      zoom: DEFAULT_3D_ZOOM,
      pitch: DEFAULT_3D_PITCH,
      bearing: DEFAULT_3D_BEARING,
      minZoom: 16.5,
      maxZoom: 20,
      maxPitch: 68,
      maxBounds: [
        [104.155, 17.1605],
        [104.161, 17.1657],
      ],
      attributionControl: false,
      style: {
        version: 8,
        glyphs: MAPLIBRE_THAI_GLYPHS_URL,
        light: {
          anchor: "viewport",
          color: "#FFFFFF",
          intensity: 0.45,
          position: [1.5, 200, 42],
        },
        sources: {
          campus: {
            type: "geojson",
            data: dataset.campus as unknown as GeoJSON.FeatureCollection,
          },
          water: {
            type: "geojson",
            data: dataset.water as unknown as GeoJSON.FeatureCollection,
          },
          greens: {
            type: "geojson",
            data: dataset.greens as unknown as GeoJSON.FeatureCollection,
          },
          parking: {
            type: "geojson",
            data: dataset.parking as unknown as GeoJSON.FeatureCollection,
          },
          roads: {
            type: "geojson",
            data: dataset.roads as unknown as GeoJSON.FeatureCollection,
          },
          walkways: {
            type: "geojson",
            data: dataset.walkways as unknown as GeoJSON.FeatureCollection,
          },
          buildings: {
            type: "geojson",
            data: dataset.buildings as unknown as GeoJSON.FeatureCollection,
          },
          buildingLabels: {
            type: "geojson",
            data: dataset.labels as unknown as GeoJSON.FeatureCollection,
          },
          userAccuracy: { type: "geojson", data: EMPTY_FC },
          activeTrack: { type: "geojson", data: EMPTY_FC },
          previewTrack: { type: "geojson", data: EMPTY_FC },
        },
        layers: [
          {
            id: "bg-canvas",
            type: "background",
            paint: { "background-color": "#E6EDF4" },
          },
          {
            id: "campus-ground",
            type: "fill",
            source: "campus",
            paint: { "fill-color": "#F8FAFC", "fill-opacity": 1 },
          },
          {
            id: "campus-outline",
            type: "line",
            source: "campus",
            paint: {
              "line-color": "#94A3B8",
              "line-width": 2,
              "line-dasharray": [3, 1.5],
            },
          },
          {
            id: "greens-fill",
            type: "fill",
            source: "greens",
            paint: { "fill-color": "#C6F6D5", "fill-opacity": 0.85 },
          },
          {
            id: "water-fill",
            type: "fill",
            source: "water",
            paint: { "fill-color": "#BAE6FD", "fill-opacity": 0.95 },
          },
          {
            id: "parking-fill",
            type: "fill",
            source: "parking",
            paint: { "fill-color": "#DCE5EF", "fill-opacity": 0.95 },
          },
          {
            id: "roads-casing",
            type: "line",
            source: "roads",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#CBD5E1", "line-width": 9 },
          },
          {
            id: "roads-fill",
            type: "line",
            source: "roads",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#FFFFFF", "line-width": 6 },
          },
          {
            id: "buildings-shadow",
            type: "fill",
            source: "buildings",
            paint: {
              "fill-color": "#0F172A",
              "fill-opacity": 0.14,
              "fill-translate": [5, 6],
            },
          },
          {
            id: "user-accuracy-fill",
            type: "fill",
            source: "userAccuracy",
            paint: { "fill-color": "#14B8A6", "fill-opacity": 0.16 },
          },
          {
            id: "user-accuracy-outline",
            type: "line",
            source: "userAccuracy",
            paint: {
              "line-color": "#0F766E",
              "line-width": 1.5,
              "line-opacity": 0.5,
            },
          },
          // Previewed saved track (sky blue dashed)
          {
            id: "preview-track-casing",
            type: "line",
            source: "previewTrack",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": 9,
              "line-opacity": 0.85,
            },
          },
          {
            id: "preview-track-line",
            type: "line",
            source: "previewTrack",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#0284C7",
              "line-width": 5,
              "line-dasharray": [2, 1.5],
            },
          },
          // Active Geo Tracker recorded trail (glowing orange)
          {
            id: "active-track-casing",
            type: "line",
            source: "activeTrack",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": 10.5,
              "line-opacity": 0.94,
            },
          },
          {
            id: "active-track-line",
            type: "line",
            source: "activeTrack",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#F97316",
              "line-width": 6,
              "line-opacity": 1,
            },
          },
          {
            id: "walkways-3d",
            type: "fill-extrusion",
            source: "walkways",
            paint: {
              "fill-extrusion-color": "#FDBA74",
              "fill-extrusion-height": ["coalesce", ["get", "height"], 4],
              "fill-extrusion-base": 2.6,
              "fill-extrusion-opacity": 0.48,
            },
          },
          {
            id: "buildings-3d",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["!=", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": ["coalesce", ["get", "color"], "#94A3B8"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
              "fill-extrusion-opacity": 0.92,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          {
            id: "buildings-3d-translucent",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["==", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": ["coalesce", ["get", "color"], "#94A3B8"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
              "fill-extrusion-opacity": 0.28,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          {
            id: "labels-buildings-primary",
            type: "symbol",
            source: "buildingLabels",
            minzoom: 15.5,
            filter: ["==", ["get", "priority"], 1],
            layout: {
              "text-field": ["get", "short_name"],
              "text-font": ["Noto Sans Bold"],
              "text-size": 12,
              "text-max-width": 9,
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-padding": 5,
            },
            paint: {
              "text-color": "#0F172A",
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 2.2,
            },
          },
        ],
      },
    });

    map.on("load", () => {
      setMapReady(true);
    });

    map.on("dragstart", () => {
      onFollowRef.current(false);
    });

    map.on("click", (e) => {
      onTapRef.current(
        Number(e.lngLat.lat.toFixed(7)),
        Number(e.lngLat.lng.toFixed(7))
      );
    });

    mapRef.current = map;

    return () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      startMarkerRef.current?.remove();
      startMarkerRef.current = null;
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      nodeMarkersRef.current.forEach((m) => m.remove());
      nodeMarkersRef.current = [];
      wptMarkersRef.current.forEach((m) => m.remove());
      wptMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // Initialize once when dataset loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  // Sync bound 3D buildings & labels
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !boundBuildings) return;
    const bSrc = map.getSource("buildings") as maplibregl.GeoJSONSource | undefined;
    const lSrc = map.getSource("buildingLabels") as maplibregl.GeoJSONSource | undefined;
    bSrc?.setData({
      type: "FeatureCollection",
      features: boundBuildings.features,
    } as unknown as GeoJSON.FeatureCollection);
    lSrc?.setData({
      type: "FeatureCollection",
      features: boundBuildings.labelFeatures,
    } as unknown as GeoJSON.FeatureCollection);
  }, [boundBuildings, mapReady]);

  // Sync active recorded track & start marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("activeTrack") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      if (trackPoints.length >= 2) {
        src.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: trackPoints.map(([lat, lng]) => [lng, lat]),
              },
            },
          ],
        });
      } else {
        src.setData(EMPTY_FC);
      }
    }

    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    if (trackPoints.length >= 1) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:16px;height:16px;border-radius:9999px;background:#16A34A;border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.45);";
      startMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([trackPoints[0][1], trackPoints[0][0]])
        .addTo(map);
    }
  }, [trackPoints, mapReady]);

  // Sync previewed saved track
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("previewTrack") as maplibregl.GeoJSONSource | undefined;
    const pts =
      previewTrack && Array.isArray(previewTrack.points_json)
        ? previewTrack.points_json.filter(
            (p) =>
              Array.isArray(p) &&
              p.length >= 2 &&
              typeof p[0] === "number" &&
              typeof p[1] === "number"
          )
        : [];
    if (src) {
      if (pts.length >= 2) {
        src.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: pts.map(([lat, lng]) => [lng, lat]),
              },
            },
          ],
        });
        const bounds = new maplibregl.LngLatBounds();
        pts.forEach(([lat, lng]) => bounds.extend([lng, lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 19, duration: 550 });
      } else {
        src.setData(EMPTY_FC);
      }
    }
  }, [previewTrack, mapReady]);

  // Sync live GPS marker, accuracy circle & follow camera
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const accSrc = map.getSource("userAccuracy") as maplibregl.GeoJSONSource | undefined;
    if (accSrc) {
      if (currentCoords && accuracyMeters !== null && accuracyMeters > 0) {
        const ring = createGeoJsonCircle(
          currentCoords[0],
          currentCoords[1],
          Math.min(accuracyMeters, 80)
        );
        accSrc.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [ring] },
            },
          ],
        });
      } else {
        accSrc.setData(EMPTY_FC);
      }
    }

    if (currentCoords) {
      if (!userMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pointer-events-none";
        el.style.zIndex = "35";
        el.innerHTML = buildDirectionalUserMarkerHTML(0, false, false);
        userMarkerRef.current = new maplibregl.Marker({
          element: el,
          anchor: "center",
          rotationAlignment: "map",
          pitchAlignment: "map",
        })
          .setLngLat([currentCoords[1], currentCoords[0]])
          .setRotation(userHeadingDeg)
          .addTo(map);
      } else {
        userMarkerRef.current.setLngLat([currentCoords[1], currentCoords[0]]);
        userMarkerRef.current.setRotation(userHeadingDeg);
      }

      if (followGps || !initializedGpsRef.current) {
        initializedGpsRef.current = true;
        map.easeTo({
          center: [currentCoords[1], currentCoords[0]],
          duration: 350,
        });
      }
    }
  }, [currentCoords, userHeadingDeg, accuracyMeters, followGps, mapReady]);

  // Sync manual focusCoords (when tapping a building in list)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusCoords) return;
    map.flyTo({
      center: [focusCoords[1], focusCoords[0]],
      zoom: Math.max(map.getZoom(), 18.5),
      duration: 550,
    });
  }, [focusCoords, mapReady]);

  // Sync manual draft pin marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    draftMarkerRef.current?.remove();
    draftMarkerRef.current = null;
    if (draftPinCoords) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:22px;height:22px;border-radius:9999px;background:#D97706;border:3px solid #FFFFFF;box-shadow:0 2px 10px rgba(15,23,42,0.5);";
      draftMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([draftPinCoords[1], draftPinCoords[0]])
        .addTo(map);
    }
  }, [draftPinCoords, mapReady]);

  // Sync existing nodes markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = [];

    for (const node of pinnedNodes) {
      const size = node.is_building ? 14 : 9;
      const bg = node.is_building ? "#047857" : "#2563EB";
      const el = document.createElement("div");
      el.title = node.name || `#${node.id}`;
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid #FFFFFF;box-shadow:0 1px 5px rgba(15,23,42,0.35);pointer-events:none;`;
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([node.lng, node.lat])
        .addTo(map);
      nodeMarkersRef.current.push(m);
    }
  }, [pinnedNodes, mapReady]);

  // Sync quick waypoints
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    wptMarkersRef.current.forEach((m) => m.remove());
    wptMarkersRef.current = [];

    for (const wpt of quickWaypoints) {
      const el = document.createElement("div");
      el.title = wpt.label;
      el.style.cssText =
        "width:16px;height:16px;border-radius:5px;background:#EA580C;border:2.5px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.45);";
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([wpt.lng, wpt.lat])
        .addTo(map);
      wptMarkersRef.current.push(m);
    }
  }, [quickWaypoints, mapReady]);

  const handleToggleTilt = () => {
    const map = mapRef.current;
    setIsTilted((prev) => {
      const next = !prev;
      map?.easeTo({
        pitch: next ? DEFAULT_3D_PITCH : 0,
        bearing: next ? DEFAULT_3D_BEARING : 0,
        duration: 400,
      });
      return next;
    });
  };

  return (
    <div className="relative w-full h-full bg-[#E6EDF4]">
      <div ref={containerRef} className="w-full h-full cursor-crosshair" />

      {!mapReady && (
        <div className="absolute inset-0 z-10 bg-[#E6EDF4] flex flex-col items-center justify-center gap-2 text-slate-600">
          <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
          <span className="text-sm font-semibold">กำลังเปิดแผนที่ 3D ภาคสนาม...</span>
        </div>
      )}

      {/* Right-Side Collapsible Layers Popover (3D / Satellite / Street + Tilt + Translucent) + Locate Me */}
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
              controlsOpen || translucentBuildings || !isTilted
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

              {/* 3-Mode Map Switcher */}
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

              {/* 3D Extra Switches: 2D/3D Tilt & Building Translucency */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleTilt}
                  className={`min-h-[38px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    !isTilted
                      ? "bg-teal-50 border-teal-200 text-[#0F766E]"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>{isTilted ? "มุมบน 2D" : "เอียง 3D"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTranslucentBuildings((prev) => !prev)}
                  className={`min-h-[38px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    translucentBuildings
                      ? "bg-[#0F766E] border-[#0F766E] text-white"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>โปร่งแสงตึก</span>
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
