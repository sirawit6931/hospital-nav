"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  Box,
  Building2,
  Compass,
  Crosshair,
  Eye,
  Globe,
  Loader2,
  Map as MapIcon,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import type { MapNode, RouteResponse } from "@/lib/api";
import { buildDirectionalUserMarkerHTML } from "@/lib/hospital";
import {
  bindMapNodesTo3DBuildings,
  type Building3DProps,
  type MapViewMode,
  type SakonHospital3DDataset,
} from "@/lib/hospital3d";

interface Public3DMapProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  buildings: MapNode[];
  displayOriginCoords: [number, number];
  rawOriginCoords: [number, number];
  userHeadingDeg: number;
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

const DEFAULT_3D_CENTER: [number, number] = [104.1581, 17.1633]; // [lng, lat]
const DEFAULT_3D_ZOOM = 17;
const DEFAULT_3D_PITCH = 52;
const DEFAULT_3D_BEARING = -18;

// Verified free CORS-enabled Thai PBF glyphs (Noto Sans Regular / Bold with Thai 0E00-0E7F)
const MAPLIBRE_THAI_GLYPHS_URL =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const CATEGORY_LABEL_TH: Record<string, string> = {
  er: "อุบัติเหตุฉุกเฉิน / ผู้ป่วยนอก",
  opd: "ผู้ป่วยนอก (OPD)",
  specialty: "ศูนย์เฉพาะทาง / หอผู้ป่วยใน",
  diagnostic: "ตรวจวินิจฉัย / รังสี / MRI / กายภาพ",
  maternal_child: "ตึกร่มเย็น / เด็ก / สูติ-นรีเวช",
  support: "อาคารบริการและสนับสนุน",
};

const BUILDING_INTERACTIVE_LAYERS = [
  "buildings-3d",
  "buildings-3d-translucent",
];

let cachedDataset: SakonHospital3DDataset | null = null;

export default function Public3DMap({
  mapViewMode,
  onChangeMapViewMode,
  buildings,
  displayOriginCoords,
  rawOriginCoords,
  userHeadingDeg,
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
}: Public3DMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const rawGhostMarkerRef = useRef<maplibregl.Marker | null>(null);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [dataset, setDataset] = useState<SakonHospital3DDataset | null>(
    cachedDataset
  );
  const [mapReady, setMapReady] = useState(false);
  const [isTilted3D, setIsTilted3D] = useState(true);
  const [forceTranslucent, setForceTranslucent] = useState(false);
  const [selectedCampusInfo, setSelectedCampusInfo] =
    useState<Building3DProps | null>(null);

  // Refs for stable event callbacks without recreating WebGL context
  const mockGpsRef = useRef(mockGpsEnabled);
  const onMockMapClickRef = useRef(onMockMapClick);
  const onSelectBuildingRef = useRef(onSelectBuilding);
  const nodeByFeatureIdRef = useRef<Map<string, MapNode>>(new Map());

  useEffect(() => {
    mockGpsRef.current = mockGpsEnabled;
  }, [mockGpsEnabled]);

  useEffect(() => {
    onMockMapClickRef.current = onMockMapClick;
  }, [onMockMapClick]);

  useEffect(() => {
    onSelectBuildingRef.current = onSelectBuilding;
  }, [onSelectBuilding]);

  // Load curated Sakon Nakhon Hospital 3D GeoJSON once
  useEffect(() => {
    if (cachedDataset) {
      setDataset(cachedDataset);
      return;
    }
    let cancelled = false;
    fetch("/data/sakon-hospital-3d.json")
      .then((res) => res.json())
      .then((data: SakonHospital3DDataset) => {
        cachedDataset = data;
        if (!cancelled) setDataset(data);
      })
      .catch(() => {
        // Keep clean fallback state
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Dynamically bind PostgreSQL map_nodes to 3D footprints + detect ground-floor route pass-through
  const boundBuildings = useMemo(() => {
    if (!dataset) return null;
    return bindMapNodesTo3DBuildings(
      dataset,
      buildings,
      targetBuilding?.id ?? null,
      routeData?.path ?? null,
      forceTranslucent
    );
  }, [dataset, buildings, targetBuilding?.id, routeData?.path, forceTranslucent]);

  useEffect(() => {
    if (boundBuildings) {
      nodeByFeatureIdRef.current = boundBuildings.nodeByFeatureId;
    }
  }, [boundBuildings]);

  // Initialize MapLibre GL JS WebGL 3D Map once dataset is loaded
  useEffect(() => {
    if (!containerRef.current || !dataset || mapRef.current) return;

    // Point MapLibre GL JS worker to /public/maplibre-gl-csp-worker.js for Next.js Turbopack compatibility
    maplibregl.setWorkerUrl("/maplibre-gl-csp-worker.js");

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: dataset.meta.center || DEFAULT_3D_CENTER,
      zoom: DEFAULT_3D_ZOOM,
      pitch: DEFAULT_3D_PITCH,
      bearing: DEFAULT_3D_BEARING,
      minZoom: 16.5,
      maxZoom: 20,
      maxPitch: 68,
      maxBounds: [
        [104.1550, 17.1605],
        [104.1610, 17.1657],
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
          coveredWalkwayLines: {
            type: "geojson",
            data: (dataset.covered_walkway_lines ||
              EMPTY_FC) as unknown as GeoJSON.FeatureCollection,
          },
          buildings: {
            type: "geojson",
            data: dataset.buildings as unknown as GeoJSON.FeatureCollection,
          },
          buildingLabels: {
            type: "geojson",
            data: dataset.labels as unknown as GeoJSON.FeatureCollection,
          },
          entrances: {
            type: "geojson",
            data: dataset.entrances as unknown as GeoJSON.FeatureCollection,
          },
          route: { type: "geojson", data: EMPTY_FC },
          tether: { type: "geojson", data: EMPTY_FC },
        },
        layers: [
          // Soft Apple-Maps-style background canvas
          {
            id: "bg-canvas",
            type: "background",
            paint: { "background-color": "#E6EDF4" },
          },
          // Hospital Campus Ground (OSM way/494975554)
          {
            id: "campus-ground",
            type: "fill",
            source: "campus",
            paint: {
              "fill-color": "#F8FAFC",
              "fill-opacity": 1,
            },
          },
          {
            id: "campus-outline",
            type: "line",
            source: "campus",
            paint: {
              "line-color": "#94A3B8",
              "line-width": 2.2,
              "line-dasharray": [3, 1.5],
            },
          },
          // Manicured hospital lawns & green zones
          {
            id: "greens-fill",
            type: "fill",
            source: "greens",
            paint: {
              "fill-color": "#C6F6D5",
              "fill-opacity": 0.85,
            },
          },
          {
            id: "greens-outline",
            type: "line",
            source: "greens",
            paint: {
              "line-color": "#86EFAC",
              "line-width": 1.2,
            },
          },
          // Hospital Pond (OSM way/494975546)
          {
            id: "water-fill",
            type: "fill",
            source: "water",
            paint: {
              "fill-color": "#BAE6FD",
              "fill-opacity": 0.95,
            },
          },
          {
            id: "water-outline",
            type: "line",
            source: "water",
            paint: {
              "line-color": "#38BDF8",
              "line-width": 1.8,
            },
          },
          // Parking Zones
          {
            id: "parking-fill",
            type: "fill",
            source: "parking",
            paint: {
              "fill-color": "#DCE5EF",
              "fill-opacity": 0.95,
            },
          },
          {
            id: "parking-outline",
            type: "line",
            source: "parking",
            paint: {
              "line-color": "#94A3B8",
              "line-width": 1.3,
              "line-dasharray": [2, 2],
            },
          },
          // External major & neighborhood roads
          {
            id: "roads-external-casing",
            type: "line",
            source: "roads",
            filter: ["!=", ["get", "scope"], "internal"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#CBD5E1",
              "line-width": [
                "case",
                ["==", ["get", "scope"], "major"],
                12,
                7,
              ],
            },
          },
          {
            id: "roads-external-fill",
            type: "line",
            source: "roads",
            filter: ["!=", ["get", "scope"], "internal"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": [
                "case",
                ["==", ["get", "scope"], "major"],
                9,
                5,
              ],
            },
          },
          // Internal Hospital Roads
          {
            id: "roads-internal-casing",
            type: "line",
            source: "roads",
            filter: ["==", ["get", "scope"], "internal"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#CBD5E1",
              "line-width": 8.5,
            },
          },
          {
            id: "roads-internal-fill",
            type: "line",
            source: "roads",
            filter: ["==", ["get", "scope"], "internal"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": 6,
            },
          },
          // Covered Walkway Network (ทางเชื่อมอาคารมีหลังคา — warm amber-orange & sky glow)
          {
            id: "covered-walkway-casing",
            type: "line",
            source: "coveredWalkwayLines",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": 9,
              "line-opacity": 0.9,
            },
          },
          {
            id: "covered-walkway-line",
            type: "line",
            source: "coveredWalkwayLines",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FB923C",
              "line-width": 5,
              "line-opacity": 0.85,
              "line-dasharray": [2.2, 1.2],
            },
          },
          // Subtle ground shadows underneath 3D buildings
          {
            id: "buildings-shadow",
            type: "fill",
            source: "buildings",
            paint: {
              "fill-color": "#0F172A",
              "fill-opacity": 0.13,
              "fill-translate": [5, 6],
            },
          },
          // Active Navigation Walking Route (White casing + Sky-blue glowing path — visible even under translucent buildings!)
          {
            id: "route-casing",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": 11.5,
              "line-opacity": 0.96,
            },
          },
          {
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#0EA5E9",
              "line-width": 6.5,
              "line-opacity": 1,
            },
          },
          // Mock GPS Snap-to-Path Tether Line
          {
            id: "mock-tether",
            type: "line",
            source: "tether",
            paint: {
              "line-color": "#F59E0B",
              "line-width": 2.5,
              "line-dasharray": [2, 2],
            },
          },
          // Covered 3D Walkways Canopy (soft light translucent sky/amber tint)
          {
            id: "walkways-3d",
            type: "fill-extrusion",
            source: "walkways",
            paint: {
              "fill-extrusion-color": "#FDBA74",
              "fill-extrusion-height": ["coalesce", ["get", "height"], 4.0],
              "fill-extrusion-base": 2.6,
              "fill-extrusion-opacity": 0.48,
            },
          },
          // Solid 3D Buildings (Normal opacity 0.92)
          {
            id: "buildings-3d",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["!=", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": [
                "case",
                ["boolean", ["get", "is_target"], false],
                "#BE123C",
                ["boolean", ["feature-state", "hover"], false],
                "#14B8A6",
                ["coalesce", ["get", "color"], "#94A3B8"],
              ],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.92,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          // Translucent 3D Buildings (opacity 0.35 when active route passes through ground floor or X-Ray mode ON)
          {
            id: "buildings-3d-translucent",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["==", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": [
                "case",
                ["boolean", ["get", "is_target"], false],
                "#BE123C",
                ["boolean", ["feature-state", "hover"], false],
                "#14B8A6",
                ["coalesce", ["get", "color"], "#94A3B8"],
              ],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.35,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          // === MAPLIBRE SYMBOL LAYERS (Collision-avoided Thai Labels with white halo & minzoom tiers) ===
          // Tier 1: Primary Hospital Buildings (Always shown cleanly at overview zoom)
          {
            id: "labels-buildings-primary",
            type: "symbol",
            source: "buildingLabels",
            minzoom: 15,
            filter: ["==", ["get", "priority"], 1],
            layout: {
              "text-field": ["get", "short_name"],
              "text-font": ["Noto Sans Bold"],
              "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                15.5,
                11.5,
                17.5,
                14,
              ],
              "text-max-width": 10,
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
              "text-padding": 6,
              "symbol-sort-key": ["coalesce", ["get", "sort_key"], 10],
            },
            paint: {
              "text-color": [
                "case",
                ["boolean", ["get", "is_target"], false],
                "#BE123C",
                ["==", ["get", "category"], "er"],
                "#BE123C",
                "#0F172A",
              ],
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 2.4,
              "text-halo-blur": 0.4,
            },
          },
          // Tier 2: Secondary Clinics & Wards (Shown smoothly on zoom >= 16.8 without overlapping)
          {
            id: "labels-buildings-secondary",
            type: "symbol",
            source: "buildingLabels",
            minzoom: 16.8,
            filter: ["==", ["get", "priority"], 2],
            layout: {
              "text-field": ["get", "short_name"],
              "text-font": ["Noto Sans Regular"],
              "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                16.8,
                10.5,
                18.5,
                12.5,
              ],
              "text-max-width": 9,
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
              "text-padding": 5,
              "symbol-sort-key": ["coalesce", ["get", "sort_key"], 25],
            },
            paint: {
              "text-color": "#1E293B",
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 2.2,
              "text-halo-blur": 0.3,
            },
          },
          // Tier 3: Support Buildings / Staff Quarters / Service Facilities (Shown cleanly on zoom >= 17.3)
          {
            id: "labels-buildings-detail",
            type: "symbol",
            source: "buildingLabels",
            minzoom: 17.3,
            filter: ["==", ["get", "priority"], 3],
            layout: {
              "text-field": ["get", "short_name"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 10.5,
              "text-max-width": 9,
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-padding": 5,
              "symbol-sort-key": 40,
            },
            paint: {
              "text-color": "#475569",
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 2,
            },
          },
          // Tier 3: Water & Parking Labels matching official hospital wall maps (zoom >= 16.9)
          {
            id: "labels-entrances-parking",
            type: "symbol",
            source: "entrances",
            minzoom: 16.9,
            layout: {
              "text-field": ["get", "name"],
              "text-font": ["Noto Sans Bold"],
              "text-size": 11,
              "text-max-width": 10,
              "text-anchor": "center",
              "text-allow-overlap": false,
              "text-padding": 5,
              "symbol-sort-key": 50,
            },
            paint: {
              "text-color": [
                "match",
                ["get", "kind"],
                "parking",
                "#1D4ED8",
                "water",
                "#0369A1",
                "#0F766E",
              ],
              "text-halo-color": "#FFFFFF",
              "text-halo-width": 2.2,
            },
          },
        ],
      },
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-left"
    );

    let hoveredId: string | number | null = null;

    map.on("load", () => {
      setMapReady(true);
    });

    // Hover & Click handlers across both solid & translucent 3D building layers
    for (const layerId of BUILDING_INTERACTIVE_LAYERS) {
      map.on("mousemove", layerId, (e) => {
        map.getCanvas().style.cursor = mockGpsRef.current
          ? "crosshair"
          : "pointer";
        const feat = e.features?.[0];
        if (!feat || feat.id === undefined) return;
        if (hoveredId !== null && hoveredId !== feat.id) {
          map.setFeatureState(
            { source: "buildings", id: hoveredId },
            { hover: false }
          );
        }
        hoveredId = feat.id;
        map.setFeatureState(
          { source: "buildings", id: hoveredId },
          { hover: true }
        );
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = mockGpsRef.current ? "crosshair" : "";
        if (hoveredId !== null) {
          map.setFeatureState(
            { source: "buildings", id: hoveredId },
            { hover: false }
          );
          hoveredId = null;
        }
      });

      map.on("click", layerId, (e) => {
        if (mockGpsRef.current) {
          onMockMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
          return;
        }
        const feat = e.features?.[0];
        if (!feat) return;
        const props = feat.properties as unknown as Building3DProps;
        const linkedNode = nodeByFeatureIdRef.current.get(props.id);
        if (linkedNode) {
          setSelectedCampusInfo(null);
          onSelectBuildingRef.current(linkedNode);
        } else {
          setSelectedCampusInfo(props);
        }
      });
    }

    // Click on open ground (for Mock GPS positioning or dismissing info card)
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: BUILDING_INTERACTIVE_LAYERS,
      });
      if (hits.length > 0) return;

      if (mockGpsRef.current) {
        onMockMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
      } else {
        setSelectedCampusInfo(null);
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      userMarkerRef.current?.remove();
      rawGhostMarkerRef.current?.remove();
      targetMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [dataset]);

  // Update cursor dynamically when Mock GPS toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor = mockGpsEnabled ? "crosshair" : "";
  }, [mockGpsEnabled, mapReady]);

  // Sync bound 3D buildings & MapLibre Symbol Layer labels whenever DB buildings / route / target changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !boundBuildings) return;

    const bldgSrc = map.getSource("buildings") as
      | maplibregl.GeoJSONSource
      | undefined;
    bldgSrc?.setData({
      type: "FeatureCollection",
      features: boundBuildings.features,
    } as unknown as GeoJSON.FeatureCollection);

    const labelSrc = map.getSource("buildingLabels") as
      | maplibregl.GeoJSONSource
      | undefined;
    labelSrc?.setData({
      type: "FeatureCollection",
      features: boundBuildings.labelFeatures,
    } as unknown as GeoJSON.FeatureCollection);
  }, [boundBuildings, mapReady]);

  // Sync Active Route Polyline & smooth 3D camera fitBounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const routeSrc = map.getSource("route") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!routeSrc) return;

    const path = routeData?.path ?? null;
    if (path && path.length >= 2) {
      const lngLatCoords = path.map(([lat, lng]) => [lng, lat]);
      routeSrc.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: lngLatCoords,
            },
          },
        ],
      });

      if (!mockGpsEnabled) {
        const bounds = new maplibregl.LngLatBounds();
        for (const c of lngLatCoords) {
          bounds.extend(c as [number, number]);
        }
        map.fitBounds(bounds, {
          padding: 72,
          maxZoom: 18.4,
          pitch: isTilted3D ? DEFAULT_3D_PITCH : 0,
          duration: 750,
        });
      }
    } else {
      routeSrc.setData(EMPTY_FC);
    }
  }, [routeData, mapReady, mockGpsEnabled, isTilted3D]);

  // Sync Target Destination Pulsing Pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    targetMarkerRef.current?.remove();
    targetMarkerRef.current = null;

    if (!targetBuilding) return;

    const el = document.createElement("div");
    el.className = "pointer-events-none";
    el.innerHTML = `
      <div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:-7px;border-radius:9999px;background:#BE123C;opacity:0.28;"></span>
        <span style="width:24px;height:24px;border-radius:9999px;background:#BE123C;border:3px solid #FFFFFF;box-shadow:0 3px 10px rgba(15,23,42,0.4);display:flex;align-items:center;justify-content:center;">
          <span style="width:8px;height:8px;border-radius:9999px;background:#FFFFFF;"></span>
        </span>
      </div>
    `;

    targetMarkerRef.current = new maplibregl.Marker({
      element: el,
      anchor: "center",
    })
      .setLngLat([targetBuilding.lng, targetBuilding.lat])
      .addTo(map);
  }, [targetBuilding, mapReady]);

  // Sync User GPS Directional Triangle Marker (Snapped to Path & aligned to 3D map ground/rotation)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "pointer-events-none";
      userMarkerRef.current = new maplibregl.Marker({
        element: el,
        anchor: "center",
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat([displayOriginCoords[1], displayOriginCoords[0]])
        .setRotation(userHeadingDeg)
        .addTo(map);
    }

    const modeTag = mockGpsEnabled ? "mock" : "live";
    const markerEl = userMarkerRef.current.getElement();
    if (markerEl.dataset.mode !== modeTag) {
      markerEl.dataset.mode = modeTag;
      markerEl.innerHTML = buildDirectionalUserMarkerHTML(0, mockGpsEnabled, false);
    }

    userMarkerRef.current.setLngLat([
      displayOriginCoords[1],
      displayOriginCoords[0],
    ]);
    userMarkerRef.current.setRotation(userHeadingDeg);

    const tetherSrc = map.getSource("tether") as
      | maplibregl.GeoJSONSource
      | undefined;

    if (mockGpsEnabled && isSnappedToPath) {
      if (!rawGhostMarkerRef.current) {
        const ghostEl = document.createElement("div");
        ghostEl.className = "pointer-events-none";
        ghostEl.innerHTML = `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:rgba(245,158,11,0.58);border:2px solid #FFFFFF;"></span>`;
        rawGhostMarkerRef.current = new maplibregl.Marker({
          element: ghostEl,
          anchor: "center",
        })
          .setLngLat([rawOriginCoords[1], rawOriginCoords[0]])
          .addTo(map);
      } else {
        rawGhostMarkerRef.current.setLngLat([
          rawOriginCoords[1],
          rawOriginCoords[0],
        ]);
      }

      tetherSrc?.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [rawOriginCoords[1], rawOriginCoords[0]],
                [displayOriginCoords[1], displayOriginCoords[0]],
              ],
            },
          },
        ],
      });
    } else {
      rawGhostMarkerRef.current?.remove();
      rawGhostMarkerRef.current = null;
      tetherSrc?.setData(EMPTY_FC);
    }
  }, [
    displayOriginCoords,
    rawOriginCoords,
    userHeadingDeg,
    isSnappedToPath,
    mockGpsEnabled,
    mapReady,
  ]);

  // Smooth camera focus when selecting a building card
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusedNode) return;
    map.flyTo({
      center: [focusedNode.lng, focusedNode.lat],
      zoom: 17.8,
      pitch: isTilted3D ? DEFAULT_3D_PITCH : 0,
      duration: 650,
    });
  }, [focusedNode, mapReady, isTilted3D]);

  const handleToggleTilt = useCallback(() => {
    const map = mapRef.current;
    setIsTilted3D((prev) => {
      const next = !prev;
      map?.easeTo({
        pitch: next ? DEFAULT_3D_PITCH : 0,
        bearing: next ? DEFAULT_3D_BEARING : 0,
        duration: 500,
      });
      return next;
    });
  }, []);

  const handleResetCampusView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setIsTilted3D(true);
    map.easeTo({
      center: dataset?.meta.center || DEFAULT_3D_CENTER,
      zoom: DEFAULT_3D_ZOOM,
      pitch: DEFAULT_3D_PITCH,
      bearing: DEFAULT_3D_BEARING,
      duration: 650,
    });
  }, [dataset]);

  const hasRoutePath = Boolean(routeData?.path && routeData.path.length >= 2);

  return (
    <div className="relative w-full h-full bg-[#E6EDF4]">
      <div ref={containerRef} className="w-full h-full" />

      {!mapReady && (
        <div className="absolute inset-0 z-10 bg-[#E6EDF4] flex flex-col items-center justify-center gap-2 text-slate-600">
          <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
          <span className="text-sm font-semibold">
            กำลังสร้างแผนที่ 3D โรงพยาบาลสกลนคร...
          </span>
        </div>
      )}

      {/* Top-Center Live Navigation Status Pill */}
      {(isAutoRerouting ||
        (targetBuilding && distanceToTargetMeters !== null)) && (
        <div className="absolute top-3 left-14 right-44 z-[400] flex justify-center pointer-events-none">
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
                ห่างปลายทาง{" "}
                {Math.max(0, Math.round(distanceToTargetMeters ?? 0))} ม.
              </span>
              {boundBuildings?.hasRouteThroughAnyBuilding && (
                <span className="hidden sm:inline text-[#0F766E] border-l border-slate-200 pl-2">
                  ทางเดินผ่านชั้นล่างตึก
                </span>
              )}
              {isSnappedToPath && !boundBuildings?.hasRouteThroughAnyBuilding && (
                <span className="hidden sm:inline text-[#047857] border-l border-slate-200 pl-2">
                  เกาะเส้นทางแล้ว
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top-Right Controls: 3-Mode Switcher + 3D Camera + Translucent + Locate + Mock GPS */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-2">
        <div
          role="group"
          aria-label="เลือกโหมดแผนที่"
          className="inline-flex items-center p-1 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md"
        >
          <button
            type="button"
            onClick={() => onChangeMapViewMode("3d")}
            className={`min-h-[38px] px-2.5 sm:px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
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
            className={`min-h-[38px] px-2.5 sm:px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
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
            className={`min-h-[38px] px-2.5 sm:px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              mapViewMode === "street"
                ? "bg-[#0F766E] text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">แผนที่ถนน</span>
            <span className="sm:hidden">ถนน</span>
          </button>
        </div>

        {/* 3D Tilt, Translucent Ground-Floor View & Reset Row */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleTilt}
            title="สลับมุมมองเอียง 3D / มุมบน 2D"
            className="min-h-[42px] px-3 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-slate-50 text-xs font-bold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
          >
            <Box className="w-4 h-4 text-[#0F766E]" />
            <span>{isTilted3D ? "มุมบน 2D" : "เอียง 3D"}</span>
          </button>

          <button
            type="button"
            onClick={() => setForceTranslucent((prev) => !prev)}
            title="เปิด/ปิดโหมดโปร่งแสงเพื่อดูเส้นทางทะลุชั้นล่างอาคาร"
            className={`min-h-[42px] px-3 rounded-xl border shadow-md text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              forceTranslucent
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-teal-50"
            }`}
          >
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">โปร่งแสง</span>
          </button>

          <button
            type="button"
            onClick={handleResetCampusView}
            title="รีเซ็ตมุมกล้องศูนย์กลาง รพ.สกลนคร"
            className="min-h-[42px] min-w-[42px] rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-slate-50 text-slate-700 flex items-center justify-center cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Locate Me */}
        <button
          type="button"
          onClick={onLocateMe}
          title="ตำแหน่งของฉัน"
          className="min-h-[42px] px-3.5 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-teal-50 text-xs font-bold text-[#0F766E] flex items-center gap-2 cursor-pointer"
        >
          <Crosshair className="w-4 h-4" />
          <span>ตำแหน่งฉัน</span>
        </button>

        {/* Mock GPS Toggle */}
        <button
          type="button"
          onClick={onToggleMockGps}
          title="เปิด/ปิดโหมดจำลองพิกัด GPS สำหรับทดสอบ"
          className={`min-h-[42px] px-3.5 rounded-xl border shadow-md text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
            mockGpsEnabled
              ? "bg-amber-500 border-amber-600 text-white hover:bg-amber-600"
              : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-amber-50 hover:border-amber-300"
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>{mockGpsEnabled ? "ปิดจำลอง GPS" : "จำลอง GPS"}</span>
        </button>
      </div>

      {/* Campus Building Info Card (when clicking a 3D building not yet linked in DB) */}
      {selectedCampusInfo && !mockGpsEnabled && (
        <div className="absolute bottom-28 md:bottom-16 left-4 z-[430] max-w-sm w-full rounded-2xl bg-white/96 backdrop-blur border border-slate-200 shadow-xl p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <div
                className="w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs"
                style={{ backgroundColor: selectedCampusInfo.color }}
              >
                <Building2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-heading text-sm font-bold text-[#0F172A] leading-snug">
                  {selectedCampusInfo.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {CATEGORY_LABEL_TH[selectedCampusInfo.category] ||
                    "อาคารภายใน รพ.สกลนคร"}{" "}
                  • {selectedCampusInfo.levels} ชั้น (~{selectedCampusInfo.height} ม.)
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedCampusInfo(null)}
              aria-label="ปิดข้อมูลอาคาร"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {selectedCampusInfo.indoor_guide ? (
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line max-h-40 overflow-y-auto bg-slate-50 rounded-xl p-2.5 border border-slate-100">
              {selectedCampusInfo.indoor_guide}
            </p>
          ) : (
            <p className="text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-[#0F766E] shrink-0 mt-0.5" />
              <span>
                สามารถเชื่อมจุดอาคารนี้เข้ากับระบบนำทางได้ที่หน้า Admin Map Editor
              </span>
            </p>
          )}
        </div>
      )}

      {/* Floating Mock GPS Simulator Bar */}
      {mockGpsEnabled && (
        <div className="absolute bottom-28 md:bottom-16 left-3 right-3 md:left-4 md:right-4 z-[420] flex justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-lg w-full rounded-2xl bg-white/96 backdrop-blur border border-amber-300 shadow-xl px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                <Compass className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  โหมดจำลองพิกัด 3D (คลิกบนพื้นที่แผนที่เพื่อวางจุดยืน หรือจำลองการเดิน)
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
                เลือกอาคารปลายทางก่อน เพื่อใช้งานปุ่มจำลองเดินตามเส้นทาง (หรือคลิกบนแผนที่ 3D เพื่อกำหนดจุดยืนจำลองได้เลย)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom 3D Campus Legend (Desktop) */}
      <div className="hidden md:flex absolute bottom-4 left-4 right-4 z-[400] pointer-events-none justify-between items-center gap-2">
        <div className="pointer-events-auto rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md px-3.5 py-2 flex flex-wrap items-center gap-3.5 text-xs font-semibold text-slate-700">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-[#E11D48] inline-block" />
            อาคารอุบัติเหตุฉุกเฉินและผู้ป่วยนอก
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-[#059669] inline-block" />
            ตึกร่มเย็น
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-xs bg-[#0F766E] inline-block" />
            ตึกร่มธรรม / อาคารหัวใจเพื่อแผ่นดิน
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-[#FB923C] inline-block" />
            ทางเชื่อมมีหลังคา
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-1.5 rounded-full bg-[#0EA5E9] inline-block" />
            เส้นทางนำทาง
          </span>
        </div>

        <div className="pointer-events-auto rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md px-3.5 py-2 text-xs font-semibold text-[#0F766E]">
          แผนผังโรงพยาบาลสกลนคร • แตะอาคารเพื่อดูรายละเอียดหรือนำทาง
        </div>
      </div>
    </div>
  );
}
