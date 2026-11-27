"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  Box,
  Building2,
  Compass,
  Eye,
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
  buildDirectionalUserMarkerHTML,
  createGeoJsonCircle,
} from "@/lib/hospital";
import {
  apply3DOverrides,
  bindMapNodesTo3DBuildings,
  type Building3DProps,
  type Map3DOverridesPayload,
  type MapViewMode,
  type SakonHospital3DDataset,
} from "@/lib/hospital3d";
import type { ActiveNavigationProgress } from "@/lib/navigation";
import ActiveNavigationOverlay from "@/components/ActiveNavigationOverlay";

interface Public3DMapProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  buildings: MapNode[];
  categories?: Category[];
  previewVersionId?: number | null;
  displayOriginCoords: [number, number];
  rawOriginCoords: [number, number];
  userHeadingDeg: number;
  gpsStatus: "idle" | "locating" | "ready" | "fallback";
  gpsAccuracyMeters: number | null;
  followUser: boolean;
  headingUpMode: boolean;
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
  onToggleHeadingUp: () => void;
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
  categories = [],
  previewVersionId = null,
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
}: Public3DMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const rawGhostMarkerRef = useRef<maplibregl.Marker | null>(null);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [dataset, setDataset] = useState<SakonHospital3DDataset | null>(
    cachedDataset
  );
  const [overrides3D, setOverrides3D] = useState<Map3DOverridesPayload | null>(
    null
  );
  const [mapReady, setMapReady] = useState(false);
  const [isTilted3D, setIsTilted3D] = useState(true);
  const [forceTranslucent, setForceTranslucent] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedCampusInfo, setSelectedCampusInfo] =
    useState<Building3DProps | null>(null);

  const controlsPopoverRef = useRef<HTMLDivElement | null>(null);
  const legendPopoverRef = useRef<HTMLDivElement | null>(null);

  // Close floating popovers when clicking outside
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

  // Refs for stable event callbacks without recreating WebGL context
  const mockGpsRef = useRef(mockGpsEnabled);
  const onMockMapClickRef = useRef(onMockMapClick);
  const onSelectBuildingRef = useRef(onSelectBuilding);
  const onChangeFollowUserRef = useRef(onChangeFollowUser);
  const nodeByFeatureIdRef = useRef<Map<string, MapNode>>(new Map());
  const lastHeadingCameraAtRef = useRef<number>(0);

  useEffect(() => {
    mockGpsRef.current = mockGpsEnabled;
  }, [mockGpsEnabled]);

  useEffect(() => {
    onMockMapClickRef.current = onMockMapClick;
  }, [onMockMapClick]);

  useEffect(() => {
    onSelectBuildingRef.current = onSelectBuilding;
  }, [onSelectBuilding]);

  useEffect(() => {
    onChangeFollowUserRef.current = onChangeFollowUser;
  }, [onChangeFollowUser]);

  // Load curated Sakon Nakhon Hospital 3D GeoJSON + any saved Admin 3D overrides
  useEffect(() => {
    let cancelled = false;

    if (cachedDataset) {
      setDataset(cachedDataset);
    } else {
      fetch("/data/sakon-hospital-3d.json")
        .then((res) => res.json())
        .then((data: SakonHospital3DDataset) => {
          cachedDataset = data;
          if (!cancelled) setDataset(data);
        })
        .catch(() => {
          // Keep clean fallback state
        });
    }

    const overridesUrl = previewVersionId
      ? `/api/map-3d-overrides?preview_version_id=${previewVersionId}`
      : "/api/map-3d-overrides";

    fetch(overridesUrl, { cache: "no-store" })
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
  }, [previewVersionId]);

  // Apply Admin 3D model overrides, bind PostgreSQL map_nodes, and make buildings translucent when user walks inside
  const boundBuildings = useMemo(() => {
    if (!dataset) return null;
    const effectiveDataset = apply3DOverrides(dataset, overrides3D);
    return bindMapNodesTo3DBuildings(
      effectiveDataset,
      buildings,
      targetBuilding?.id ?? null,
      routeData?.path ?? null,
      forceTranslucent,
      null,
      displayOriginCoords
    );
  }, [
    dataset,
    overrides3D,
    buildings,
    targetBuilding?.id,
    routeData?.path,
    forceTranslucent,
    displayOriginCoords,
  ]);

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
          trees: {
            type: "geojson",
            data: (dataset.trees ||
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
          routePassed: { type: "geojson", data: EMPTY_FC },
          tether: { type: "geojson", data: EMPTY_FC },
          userAccuracy: { type: "geojson", data: EMPTY_FC },
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
              "fill-opacity": 0.14,
              "fill-translate": [5, 6],
            },
          },
          // Crisp architectural footprint outline (isometric wall-map style)
          {
            id: "buildings-outline",
            type: "line",
            source: "buildings",
            paint: {
              "line-color": "#475569",
              "line-width": 1.1,
              "line-opacity": 0.55,
            },
          },
          // Stylized 3D Trees (matching isometric wall map greenery)
          {
            id: "trees-3d",
            type: "fill-extrusion",
            source: "trees",
            paint: {
              "fill-extrusion-color": ["coalesce", ["get", "color"], "#4D9A3D"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 2],
              "fill-extrusion-opacity": 0.9,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          // Real-Time GPS Accuracy Halo Ring
          {
            id: "user-accuracy-fill",
            type: "fill",
            source: "userAccuracy",
            paint: {
              "fill-color": "#14B8A6",
              "fill-opacity": 0.14,
            },
          },
          {
            id: "user-accuracy-outline",
            type: "line",
            source: "userAccuracy",
            paint: {
              "line-color": "#0F766E",
              "line-width": 1.4,
              "line-opacity": 0.45,
            },
          },
          // Already-walked Navigation Segment (Faded Slate Gray during Active Navigation)
          {
            id: "route-passed-casing",
            type: "line",
            source: "routePassed",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FFFFFF",
              "line-width": 9.5,
              "line-opacity": 0.78,
            },
          },
          {
            id: "route-passed-line",
            type: "line",
            source: "routePassed",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#94A3B8",
              "line-width": 5.5,
              "line-opacity": 0.85,
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
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
              "fill-extrusion-opacity": 0.94,
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
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
              "fill-extrusion-opacity": 0.28,
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

    // Disengage auto-follow when user manually pans/drags or rotates the map
    map.on("dragstart", (e) => {
      if (e.originalEvent) {
        onChangeFollowUserRef.current(false);
      }
    });
    map.on("rotatestart", (e) => {
      if (e.originalEvent) {
        onChangeFollowUserRef.current(false);
      }
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
        const linkedNode =
          nodeByFeatureIdRef.current.get(props.id) ||
          (props.parent_id
            ? nodeByFeatureIdRef.current.get(props.parent_id)
            : undefined);
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

  // Sync Active Route Polyline (splits into faded passedPath + bright remainingPath during Active Navigation)
  const prevFittedRouteKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const routeSrc = map.getSource("route") as
      | maplibregl.GeoJSONSource
      | undefined;
    const passedSrc = map.getSource("routePassed") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!routeSrc) return;

    const path = routeData?.path ?? null;
    if (path && path.length >= 2) {
      if (isNavigating && navProgress) {
        const remCoords = navProgress.remainingPath.map(([lat, lng]) => [
          lng,
          lat,
        ]);
        const passCoords = navProgress.passedPath.map(([lat, lng]) => [
          lng,
          lat,
        ]);
        routeSrc.setData(
          remCoords.length >= 2
            ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: remCoords },
                },
              ],
            }
            : EMPTY_FC
        );
        passedSrc?.setData(
          passCoords.length >= 2
            ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: passCoords },
                },
              ],
            }
            : EMPTY_FC
        );
      } else {
        passedSrc?.setData(EMPTY_FC);
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

        const routeKey = `${routeData?.target_building?.id}-${path.length}-${Math.round(
          routeData?.total_distance_m ?? 0
        )}`;
        if (!mockGpsEnabled && prevFittedRouteKeyRef.current !== routeKey) {
          prevFittedRouteKeyRef.current = routeKey;
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
      }
    } else {
      prevFittedRouteKeyRef.current = null;
      routeSrc.setData(EMPTY_FC);
      passedSrc?.setData(EMPTY_FC);
    }
  }, [routeData, isNavigating, navProgress, mapReady, mockGpsEnabled, isTilted3D]);

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

    // Update real-time GPS accuracy circle around user
    const accSrc = map.getSource("userAccuracy") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (accSrc) {
      if (!mockGpsEnabled && gpsStatus === "ready" && gpsAccuracyMeters !== null) {
        const clampedRadius = Math.max(3, Math.min(45, gpsAccuracyMeters));
        accSrc.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [
                  createGeoJsonCircle(
                    displayOriginCoords[0],
                    displayOriginCoords[1],
                    clampedRadius
                  ),
                ],
              },
            },
          ],
        });
      } else {
        accSrc.setData(EMPTY_FC);
      }
    }

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
    gpsStatus,
    gpsAccuracyMeters,
    isSnappedToPath,
    mockGpsEnabled,
    mapReady,
  ]);

  // Immediately fly to user's live GPS location when "ตำแหน่งฉัน" is tapped
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || locateTrigger <= 0) return;
    map.easeTo({
      center: [displayOriginCoords[1], displayOriginCoords[0]],
      zoom: Math.max(map.getZoom(), 18.2),
      pitch: isTilted3D ? DEFAULT_3D_PITCH : 0,
      bearing: headingUpMode ? userHeadingDeg : map.getBearing(),
      duration: 600,
    });
    // Only trigger on explicit locate button taps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateTrigger, mapReady]);

  // Active Navigation 3D Camera Transitions (Enter = zoom 19.2, pitch 60, heading-up; Exit = overview)
  const prevIsNavigatingRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (isNavigating && !prevIsNavigatingRef.current) {
      const navBearing = isSimulatingWalk
        ? navProgress?.currentSegmentBearingDeg ?? userHeadingDeg
        : userHeadingDeg;
      setIsTilted3D(true);
      map.easeTo({
        center: [displayOriginCoords[1], displayOriginCoords[0]],
        zoom: 19.2,
        pitch: 60,
        bearing: navBearing,
        duration: 750,
        essential: true,
      });
    } else if (!isNavigating && prevIsNavigatingRef.current) {
      map.easeTo({
        zoom: 17.5,
        pitch: DEFAULT_3D_PITCH,
        bearing: DEFAULT_3D_BEARING,
        duration: 650,
        essential: true,
      });
    }
    prevIsNavigatingRef.current = isNavigating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating, mapReady]);

  // Recenter button tap during Active Navigation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !isNavigating || recenterTrigger <= 0) return;
    const navBearing = isSimulatingWalk
      ? navProgress?.currentSegmentBearingDeg ?? userHeadingDeg
      : userHeadingDeg;
    map.easeTo({
      center: [displayOriginCoords[1], displayOriginCoords[0]],
      zoom: 19.2,
      pitch: 60,
      bearing: navBearing,
      duration: 550,
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTrigger, mapReady]);

  // Smooth real-time camera follow while walking (and heading-up bearing in Active Nav / Heading-Up mode)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !followUser) return;
    if (isNavigating) {
      const navBearing = isSimulatingWalk
        ? navProgress?.currentSegmentBearingDeg ?? userHeadingDeg
        : userHeadingDeg;
      map.easeTo({
        center: [displayOriginCoords[1], displayOriginCoords[0]],
        bearing: navBearing,
        pitch: 60,
        zoom: Math.max(map.getZoom(), 19.0),
        duration: 320,
        essential: true,
      });
      return;
    }
    map.easeTo({
      center: [displayOriginCoords[1], displayOriginCoords[0]],
      duration: 450,
      essential: true,
    });
  }, [
    displayOriginCoords,
    followUser,
    isNavigating,
    isSimulatingWalk,
    navProgress?.currentSegmentBearingDeg,
    userHeadingDeg,
    mapReady,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !followUser || !headingUpMode || isNavigating) return;
    const now = Date.now();
    if (now - lastHeadingCameraAtRef.current < 180) return;
    lastHeadingCameraAtRef.current = now;
    map.easeTo({
      bearing: userHeadingDeg,
      duration: 240,
      essential: true,
    });
  }, [userHeadingDeg, followUser, headingUpMode, isNavigating, mapReady]);

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

      {/* Top-Center Compact 1-Line Navigation Status Pill (only in route preview mode, hidden during Active Navigation) */}
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
                  className={`w-2 h-2 rounded-full shrink-0 ${isSnappedToPath ? "bg-[#047857]" : "bg-[#0EA5E9]"
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

      {/* Top-Right Collapsible Map Controls (shifts neatly below Top Turn Banner during Active Navigation) */}
      <div
        ref={controlsPopoverRef}
        className={`absolute right-3 z-[410] flex flex-col items-end gap-2 ${isNavigating ? "top-36 sm:top-32" : "top-3"
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
            className={`w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors cursor-pointer ${controlsOpen || mockGpsEnabled
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
                  className={`min-h-[34px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${mapViewMode === "3d"
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
                  className={`min-h-[34px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${mapViewMode === "satellite"
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
                  className={`min-h-[34px] rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer ${mapViewMode === "street"
                    ? "bg-[#0F766E] text-white shadow-xs"
                    : "text-slate-600 hover:bg-white"
                    }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>ถนน</span>
                </button>
              </div>

              {/* 3D Display Controls */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleTilt}
                  className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${!isTilted3D
                    ? "bg-teal-50 border-teal-200 text-[#0F766E]"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>{isTilted3D ? "มุมบน 2D" : "เอียง 3D"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setForceTranslucent((prev) => !prev)}
                  className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${forceTranslucent
                    ? "bg-[#0F766E] border-[#0F766E] text-white"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>โปร่งแสง</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleResetCampusView();
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
                  className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${mockGpsEnabled
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
          className={`w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors cursor-pointer ${followUser
            ? "bg-[#0F766E] border-[#0F766E] text-white"
            : "bg-white/95 backdrop-blur border-slate-200 text-[#0F766E] hover:bg-teal-50"
            }`}
        >
          <LocateFixed className="w-4 h-4" />
        </button>

        {/* 3) Heading-Up Mode (40x40px) */}
        <button
          type="button"
          onClick={onToggleHeadingUp}
          title={
            headingUpMode && followUser
              ? "ปิดโหมดหมุนแผนที่ตามทิศ"
              : "หมุนแผนที่ตามทิศ"
          }
          aria-label="หมุนตามทิศ"
          className={`w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors cursor-pointer ${headingUpMode && followUser
            ? "bg-[#0F766E] border-[#0F766E] text-white"
            : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
        >
          <Compass className="w-4 h-4" />
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

      {/* Bottom-Left Collapsible Legend Button ("คำอธิบายสี") — hidden during Active Navigation */}
      {!isNavigating && (
        <div
          ref={legendPopoverRef}
          className="absolute bottom-32 md:bottom-4 left-3 md:left-4 z-[400]"
        >
          {legendOpen && (
            <div className="mb-2 w-64 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-lg p-3 space-y-2 text-xs font-semibold text-slate-700">
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
                {categories.filter((c) => c.show_in_legend).length > 0 ? (
                  categories
                    .filter((c) => c.show_in_legend)
                    .map((cat) => (
                      <span
                        key={`legend-3d-${cat.id}`}
                        className="flex items-center gap-2"
                      >
                        <span
                          className="w-3 h-3 rounded-xs inline-block shrink-0 border border-black/10"
                          style={{ backgroundColor: cat.color_hex }}
                        />
                        <span className="truncate">{cat.name}</span>
                      </span>
                    ))
                ) : (
                  <>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-xs bg-[#A61B29] inline-block shrink-0" />
                      อาคารอุบัติเหตุฉุกเฉินฯ
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-xs bg-[#881337] inline-block shrink-0" />
                      ตึกร่มเย็น
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-xs bg-[#EAB308] inline-block shrink-0" />
                      ตึกร่มธรรม
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-xs bg-[#4A83B4] inline-block shrink-0" />
                      อาคารหัวใจเพื่อแผ่นดิน
                    </span>
                  </>
                )}
                <span className="flex items-center gap-2 pt-1 border-t border-slate-100">
                  <span className="w-4 border-t-2 border-dashed border-[#FB923C] inline-block shrink-0" />
                  ทางเชื่อมมีหลังคา
                </span>
                <span className="flex items-center gap-2">
                  <span className="w-4 h-1.5 rounded-full bg-[#0EA5E9] inline-block shrink-0" />
                  เส้นทางนำทาง
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setLegendOpen((prev) => !prev)}
            title="คำอธิบายสี"
            aria-expanded={legendOpen}
            className={`h-9 px-3 rounded-xl border shadow-sm text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${legendOpen
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
