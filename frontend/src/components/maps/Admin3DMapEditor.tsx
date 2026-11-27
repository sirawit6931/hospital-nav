"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  Box,
  Eye,
  Globe,
  Info,
  Layers,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { MapEdge, MapNode, SurveyTrack } from "@/lib/api";
import {
  apply3DOverrides,
  bindMapNodesTo3DBuildings,
  type Building3DOverride,
  type Building3DProps,
  type Map3DOverridesPayload,
  type MapViewMode,
  type SakonHospital3DDataset,
} from "@/lib/hospital3d";
import type { AdminEditorMode } from "@/components/maps/AdminMapEditor";

interface Admin3DMapEditorProps {
  mapViewMode: MapViewMode;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  mode: AdminEditorMode;
  nodes: MapNode[];
  edges: MapEdge[];
  surveys: SurveyTrack[];
  showSurveys: boolean;
  selectedSourceNodeId: number | null;
  overrides3D?: Map3DOverridesPayload | null;
  selectedBuilding3DId?: string | null;
  selected3D?: Building3DOverride | null;
  showSatelliteUnderlay?: boolean;
  buildingOpacity?: number;
  onSelectBuilding3D?: (building: Building3DProps | null) => void;
  onBeginTransform3D?: () => void;
  onLiveTransform3D?: (patch: Partial<Building3DOverride>) => void;
  onMapCenterChange?: (lat: number, lng: number) => void;
  onMapClick: (lat: number, lng: number) => void;
  onNodeClick: (node: MapNode) => void;
  onEdgeClick: (edge: MapEdge) => void;
  splitTrackId?: number | null;
  onSplitTrackClick?: (trackId: number, lat: number, lng: number) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const DEFAULT_3D_CENTER: [number, number] = [104.1581, 17.1633];
const DEFAULT_3D_ZOOM = 17;
const DEFAULT_3D_PITCH = 50;
const DEFAULT_3D_BEARING = -18;
const MAPLIBRE_THAI_GLYPHS_URL =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

let cachedAdmin3DDataset: SakonHospital3DDataset | null = null;

function localOffsetToLngLat(
  centerLat: number,
  centerLng: number,
  angleDeg: number,
  lx: number,
  ly: number
): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const rx = lx * cosA - ly * sinA;
  const ry = lx * sinA + ly * cosA;
  return [
    centerLng + rx / (111320 * cosLat),
    centerLat + ry / 111320,
  ];
}

function lngLatToLocalMeters(
  centerLat: number,
  centerLng: number,
  angleDeg: number,
  lng: number,
  lat: number
): { lx: number; ly: number } {
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dx = (lng - centerLng) * 111320 * cosLat;
  const dy = (lat - centerLat) * 111320;
  const rad = (-angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  return {
    lx: dx * cosA - dy * sinA,
    ly: dx * sinA + dy * cosA,
  };
}

export default function Admin3DMapEditor({
  mapViewMode,
  onChangeMapViewMode,
  mode,
  nodes,
  edges,
  surveys,
  showSurveys,
  selectedSourceNodeId,
  overrides3D,
  selectedBuilding3DId,
  selected3D,
  showSatelliteUnderlay = false,
  buildingOpacity = 0.92,
  onSelectBuilding3D,
  onBeginTransform3D,
  onLiveTransform3D,
  onMapCenterChange,
  onMapClick,
  onNodeClick,
  onEdgeClick,
  splitTrackId = null,
  onSplitTrackClick,
  onRefresh,
  isRefreshing = false,
}: Admin3DMapEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const nodeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const handleMarkersRef = useRef<maplibregl.Marker[]>([]);
  const controlsPopoverRef = useRef<HTMLDivElement | null>(null);
  const legendPopoverRef = useRef<HTMLDivElement | null>(null);

  const [dataset, setDataset] = useState<SakonHospital3DDataset | null>(
    cachedAdmin3DDataset
  );
  const [mapReady, setMapReady] = useState(false);
  const [isTilted3D, setIsTilted3D] = useState(true);
  const [translucentBuildings, setTranslucentBuildings] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  // Auto-resize MapLibre canvas whenever sidebar collapses/hides or container resizes
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close floating popovers when clicking outside
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

  const modeRef = useRef(mode);
  const onMapClickRef = useRef(onMapClick);
  const onNodeClickRef = useRef(onNodeClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  const onSelectBuilding3DRef = useRef(onSelectBuilding3D);
  const onBeginTransform3DRef = useRef(onBeginTransform3D);
  const onLiveTransform3DRef = useRef(onLiveTransform3D);
  const onMapCenterChangeRef = useRef(onMapCenterChange);
  const splitTrackIdRef = useRef<number | null>(splitTrackId ?? null);
  const onSplitTrackClickRef = useRef(onSplitTrackClick);
  const selected3DRef = useRef<Building3DOverride | null>(selected3D ?? null);
  const edgesByIdRef = useRef<Map<number, MapEdge>>(new Map());
  const buildingPropsByIdRef = useRef<Map<string, Building3DProps>>(new Map());

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    onEdgeClickRef.current = onEdgeClick;
  }, [onEdgeClick]);

  useEffect(() => {
    onSelectBuilding3DRef.current = onSelectBuilding3D;
  }, [onSelectBuilding3D]);

  useEffect(() => {
    onBeginTransform3DRef.current = onBeginTransform3D;
  }, [onBeginTransform3D]);

  useEffect(() => {
    onLiveTransform3DRef.current = onLiveTransform3D;
  }, [onLiveTransform3D]);

  useEffect(() => {
    onMapCenterChangeRef.current = onMapCenterChange;
  }, [onMapCenterChange]);

  useEffect(() => {
    splitTrackIdRef.current = splitTrackId ?? null;
  }, [splitTrackId]);

  useEffect(() => {
    onSplitTrackClickRef.current = onSplitTrackClick;
  }, [onSplitTrackClick]);

  useEffect(() => {
    selected3DRef.current = selected3D ?? null;
  }, [selected3D]);

  useEffect(() => {
    const m = new Map<number, MapEdge>();
    for (const e of edges) m.set(e.id, e);
    edgesByIdRef.current = m;
  }, [edges]);

  // Load 3D hospital GeoJSON once
  useEffect(() => {
    if (cachedAdmin3DDataset) {
      setDataset(cachedAdmin3DDataset);
      return;
    }
    let cancelled = false;
    fetch("/data/sakon-hospital-3d.json")
      .then((res) => res.json())
      .then((data: SakonHospital3DDataset) => {
        cachedAdmin3DDataset = data;
        if (!cancelled) setDataset(data);
      })
      .catch(() => {
        // Handled silently
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buildingNodes = useMemo(
    () => nodes.filter((n) => n.is_building),
    [nodes]
  );

  const boundBuildings = useMemo(() => {
    if (!dataset) return null;
    const effectiveDataset = apply3DOverrides(dataset, overrides3D);
    return bindMapNodesTo3DBuildings(
      effectiveDataset,
      buildingNodes,
      null,
      null,
      translucentBuildings && mode !== "customize_3d",
      selectedBuilding3DId ?? null
    );
  }, [
    dataset,
    overrides3D,
    buildingNodes,
    translucentBuildings,
    mode,
    selectedBuilding3DId,
  ]);

  useEffect(() => {
    const m = new Map<string, Building3DProps>();
    if (boundBuildings) {
      for (const f of boundBuildings.features) {
        m.set(f.properties.id, f.properties);
      }
    }
    buildingPropsByIdRef.current = m;
  }, [boundBuildings]);

  const nodeById = useMemo(() => {
    const m = new Map<number, MapNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Initialize MapLibre GL JS WebGL 3D Admin Map
  useEffect(() => {
    if (!containerRef.current || !dataset || mapRef.current) return;

    maplibregl.setWorkerUrl("/maplibre-gl-csp-worker.js");

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: dataset.meta.center || DEFAULT_3D_CENTER,
      zoom: DEFAULT_3D_ZOOM,
      pitch: DEFAULT_3D_PITCH,
      bearing: DEFAULT_3D_BEARING,
      minZoom: 16,
      maxZoom: 20,
      maxPitch: 68,
      maxBounds: [
        [104.1546, 17.1602],
        [104.1614, 17.1660],
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
          satelliteUnderlay: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 18,
          },
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
          adminEdges: { type: "geojson", data: EMPTY_FC },
          adminSurveys: { type: "geojson", data: EMPTY_FC },
          transformGuides: { type: "geojson", data: EMPTY_FC },
        },
        layers: [
          {
            id: "bg-canvas",
            type: "background",
            paint: { "background-color": "#E6EDF4" },
          },
          // Optional Esri Satellite Underlay (toggled in Mode 6 to trace real rooftops!)
          {
            id: "satellite-underlay",
            type: "raster",
            source: "satelliteUnderlay",
            paint: { "raster-opacity": 0 },
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
            paint: { "fill-color": "#C6F6D5", "fill-opacity": 0.8 },
          },
          {
            id: "water-fill",
            type: "fill",
            source: "water",
            paint: { "fill-color": "#BAE6FD", "fill-opacity": 0.92 },
          },
          {
            id: "parking-fill",
            type: "fill",
            source: "parking",
            paint: { "fill-color": "#DCE5EF", "fill-opacity": 0.9 },
          },
          {
            id: "roads-internal",
            type: "line",
            source: "roads",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#FFFFFF", "line-width": 6 },
          },
          {
            id: "covered-walkway-guide",
            type: "line",
            source: "coveredWalkwayLines",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#FDBA74",
              "line-width": 4,
              "line-opacity": 0.7,
              "line-dasharray": [2, 1.5],
            },
          },
          // Survey tracks (Distinct per-track colors + thicker highlight when in Split mode)
          {
            id: "admin-surveys-line",
            type: "line",
            source: "adminSurveys",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["coalesce", ["get", "color"], "#F97316"],
              "line-width": [
                "case",
                ["boolean", ["get", "is_splitting"], false],
                8,
                5,
              ],
              "line-opacity": 0.92,
            },
          },
          // Admin Edges: Active (solid sky-blue) & Inactive (red dashed)
          {
            id: "admin-edges-active",
            type: "line",
            source: "adminEdges",
            filter: ["==", ["get", "is_active"], true],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#0EA5E9",
              "line-width": 5.5,
              "line-opacity": 0.96,
            },
          },
          {
            id: "admin-edges-inactive",
            type: "line",
            source: "adminEdges",
            filter: ["==", ["get", "is_active"], false],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#DC2626",
              "line-width": 5.5,
              "line-opacity": 0.95,
              "line-dasharray": [2, 1.5],
            },
          },
          // Wide invisible hitbox so clicking edges in 3D is easy
          {
            id: "admin-edges-hitbox",
            type: "line",
            source: "adminEdges",
            paint: {
              "line-color": "#000000",
              "line-width": 16,
              "line-opacity": 0,
            },
          },
          // Crisp architectural footprint outlines & stylized 3D trees
          {
            id: "buildings-outline",
            type: "line",
            source: "buildings",
            paint: {
              "line-color": [
                "case",
                ["boolean", ["get", "is_selected"], false],
                "#0EA5E9",
                "#475569",
              ],
              "line-width": [
                "case",
                ["boolean", ["get", "is_selected"], false],
                3.5,
                1.1,
              ],
              "line-opacity": 0.75,
            },
          },
          {
            id: "trees-3d",
            type: "fill-extrusion",
            source: "trees",
            paint: {
              "fill-extrusion-color": ["coalesce", ["get", "color"], "#4D9A3D"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 2],
              "fill-extrusion-opacity": 0.88,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          // Solid 3D Buildings (opacity 0.92; highlights selected building in customize_3d mode)
          {
            id: "buildings-3d-solid",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["!=", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": [
                "case",
                ["boolean", ["get", "is_selected"], false],
                "#0EA5E9",
                ["coalesce", ["get", "color"], "#94A3B8"],
              ],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
              "fill-extrusion-opacity": 0.92,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          // Translucent 3D Buildings (opacity 0.35 so ground-floor nodes & edges are visible!)
          {
            id: "buildings-3d-translucent",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["==", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": [
                "case",
                ["boolean", ["get", "is_selected"], false],
                "#0EA5E9",
                ["coalesce", ["get", "color"], "#94A3B8"],
              ],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
              "fill-extrusion-opacity": 0.35,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          // Rotate stem / transform guide line for Mode 6 selected building
          {
            id: "transform-guides-line",
            type: "line",
            source: "transformGuides",
            paint: {
              "line-color": "#059669",
              "line-width": 2.4,
              "line-dasharray": [2, 1.5],
            },
          },
          // Building Names Symbol Layer (Primary buildings cleanly labeled)
          {
            id: "admin-building-labels",
            type: "symbol",
            source: "buildingLabels",
            minzoom: 16,
            filter: ["==", ["get", "priority"], 1],
            layout: {
              "text-field": ["get", "short_name"],
              "text-font": ["Noto Sans Bold"],
              "text-size": 12,
              "text-max-width": 10,
              "text-allow-overlap": false,
              "text-padding": 6,
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

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-left"
    );

    map.on("load", () => {
      setMapReady(true);
      const c = map.getCenter();
      onMapCenterChangeRef.current?.(c.lat, c.lng);
    });

    map.on("moveend", () => {
      const c = map.getCenter();
      onMapCenterChangeRef.current?.(c.lat, c.lng);
    });

    map.on("mouseenter", "admin-edges-hitbox", () => {
      if (modeRef.current === "toggle_edge" || modeRef.current === "delete") {
        map.getCanvas().style.cursor = "pointer";
      }
    });

    map.on("mouseleave", "admin-edges-hitbox", () => {
      map.getCanvas().style.cursor =
        modeRef.current === "add_node" ? "crosshair" : "";
    });

    map.on("click", "admin-edges-hitbox", (e) => {
      if (modeRef.current !== "toggle_edge" && modeRef.current !== "delete") {
        return;
      }
      const feat = e.features?.[0];
      const edgeId = Number(feat?.properties?.id);
      const edge = edgesByIdRef.current.get(edgeId);
      if (edge) {
        onEdgeClickRef.current(edge);
      }
    });

    // Click any 3D building/wing in customize_3d mode to select & stretch/extrude it
    for (const bLayer of ["buildings-3d-solid", "buildings-3d-translucent"]) {
      map.on("mouseenter", bLayer, () => {
        if (modeRef.current === "customize_3d") {
          map.getCanvas().style.cursor = "pointer";
        }
      });
      map.on("mouseleave", bLayer, () => {
        if (modeRef.current === "customize_3d") {
          map.getCanvas().style.cursor = "crosshair";
        }
      });
      map.on("click", bLayer, (e) => {
        if (modeRef.current !== "customize_3d") return;
        const feat = e.features?.[0];
        if (!feat) return;
        const bId = feat.properties?.id ? String(feat.properties.id) : null;
        if (!bId) return;
        const fullProps =
          buildingPropsByIdRef.current.get(bId) ||
          (feat.properties as unknown as Building3DProps);
        onSelectBuilding3DRef.current?.(fullProps);
      });
    }

    map.on("click", (e) => {
      if (splitTrackIdRef.current !== null) {
        onSplitTrackClickRef.current?.(
          splitTrackIdRef.current,
          e.lngLat.lat,
          e.lngLat.lng
        );
        return;
      }
      if (modeRef.current === "add_node") {
        onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (modeRef.current === "customize_3d") {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ["buildings-3d-solid", "buildings-3d-translucent"],
        });
        if (hits.length > 0) return;
        onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.resize());
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      for (const m of nodeMarkersRef.current) m.remove();
      nodeMarkersRef.current = [];
      for (const m of handleMarkersRef.current) m.remove();
      handleMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [dataset]);

  // Sync Satellite Underlay & Live 3D Building Opacity (Mode 6 rooftop alignment helper)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const satOn = mode === "customize_3d" && showSatelliteUnderlay;
    if (map.getLayer("satellite-underlay")) {
      map.setPaintProperty("satellite-underlay", "raster-opacity", satOn ? 1 : 0);
    }
    if (map.getLayer("campus-ground")) {
      map.setPaintProperty("campus-ground", "fill-opacity", satOn ? 0 : 1);
    }
    if (map.getLayer("greens-fill")) {
      map.setPaintProperty("greens-fill", "fill-opacity", satOn ? 0 : 0.8);
    }
    if (map.getLayer("water-fill")) {
      map.setPaintProperty("water-fill", "fill-opacity", satOn ? 0 : 0.92);
    }
    if (map.getLayer("parking-fill")) {
      map.setPaintProperty("parking-fill", "fill-opacity", satOn ? 0 : 0.9);
    }
    if (map.getLayer("roads-internal")) {
      map.setPaintProperty("roads-internal", "line-opacity", satOn ? 0.25 : 1);
    }
    if (map.getLayer("buildings-3d-solid")) {
      const targetOpacity =
        mode === "customize_3d"
          ? Math.max(0.2, Math.min(1, buildingOpacity))
          : 0.92;
      map.setPaintProperty(
        "buildings-3d-solid",
        "fill-extrusion-opacity",
        targetOpacity
      );
    }
  }, [mode, showSatelliteUnderlay, buildingOpacity, mapReady]);

  // Interactive 3D Transform Handles (Move + 4 Edge Resize + Rotate) in Mode 6
  const selectedIdForHandles = mode === "customize_3d" ? selected3D?.id ?? null : null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const m of handleMarkersRef.current) m.remove();
    handleMarkersRef.current = [];

    if (!selectedIdForHandles || !selected3DRef.current) {
      const gSrc = map.getSource("transformGuides") as
        | maplibregl.GeoJSONSource
        | undefined;
      gSrc?.setData(EMPTY_FC);
      return;
    }

    const startPointerDrag = (
      ev: PointerEvent,
      onMoveLngLat: (lngLat: maplibregl.LngLat, startLngLat: maplibregl.LngLat, snap: Building3DOverride) => void
    ) => {
      const snap = selected3DRef.current;
      if (!snap) return;
      ev.stopPropagation();
      ev.preventDefault();

      const canvas = map.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const startLngLat = map.unproject([
        ev.clientX - rect.left,
        ev.clientY - rect.top,
      ]);

      map.dragPan.disable();
      map.dragRotate.disable();
      onBeginTransform3DRef.current?.();

      const handleMove = (moveEv: PointerEvent) => {
        moveEv.preventDefault();
        const currRect = canvas.getBoundingClientRect();
        const currLngLat = map.unproject([
          moveEv.clientX - currRect.left,
          moveEv.clientY - currRect.top,
        ]);
        onMoveLngLat(currLngLat, startLngLat, snap);
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        map.dragPan.enable();
        map.dragRotate.enable();
      };

      window.addEventListener("pointermove", handleMove, { passive: false });
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    };

    const createHandleMarker = (
      html: string,
      title: string,
      sizePx: number,
      onDrag: (lngLat: maplibregl.LngLat, startLngLat: maplibregl.LngLat, snap: Building3DOverride) => void
    ) => {
      const el = document.createElement("div");
      el.title = title;
      el.style.width = `${sizePx}px`;
      el.style.height = `${sizePx}px`;
      el.style.touchAction = "none";
      el.className = "flex items-center justify-center select-none";
      el.innerHTML = html;
      el.addEventListener("pointerdown", (ev) => startPointerDrag(ev, onDrag));
      el.addEventListener("click", (ev) => ev.stopPropagation());
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([
          selected3DRef.current!.center_lng,
          selected3DRef.current!.center_lat,
        ])
        .addTo(map);
      return marker;
    };

    // 0: Center Move Handle (Blue circle with 4-way arrows SVG)
    const moveMarker = createHandleMarker(
      `<div style="width:32px;height:32px;border-radius:9999px;background:#0284C7;border:2.5px solid #FFFFFF;box-shadow:0 3px 10px rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;cursor:move;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
      </div>`,
      "ลากเพื่อย้ายตำแหน่งบล็อก 3D",
      32,
      (curr, start, snap) => {
        const dLng = curr.lng - start.lng;
        const dLat = curr.lat - start.lat;
        onLiveTransform3DRef.current?.({
          center_lat: Number((snap.center_lat + dLat).toFixed(6)),
          center_lng: Number((snap.center_lng + dLng).toFixed(6)),
        });
      }
    );

    const resizeHandleHtml = `<div style="width:18px;height:18px;border-radius:5px;background:#FFFFFF;border:2.5px solid #0284C7;box-shadow:0 2px 6px rgba(15,23,42,0.4);cursor:grab;"></div>`;

    // 1: +W (Right/East local edge)
    const rightMarker = createHandleMarker(
      resizeHandleHtml,
      "ลากเพื่อยืด-หดด้านขวา (ความกว้าง)",
      22,
      (curr, _start, snap) => {
        const { lx } = lngLatToLocalMeters(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          curr.lng,
          curr.lat
        );
        const fixedLeft = -snap.width_m / 2;
        const nextW = Math.max(3, Math.min(160, Math.round((lx - fixedLeft) * 2) / 2));
        const shiftX = (nextW - snap.width_m) / 2;
        const [nLng, nLat] = localOffsetToLngLat(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          shiftX,
          0
        );
        onLiveTransform3DRef.current?.({
          width_m: nextW,
          center_lat: Number(nLat.toFixed(6)),
          center_lng: Number(nLng.toFixed(6)),
        });
      }
    );

    // 2: -W (Left/West local edge)
    const leftMarker = createHandleMarker(
      resizeHandleHtml,
      "ลากเพื่อยืด-หดด้านซ้าย (ความกว้าง)",
      22,
      (curr, _start, snap) => {
        const { lx } = lngLatToLocalMeters(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          curr.lng,
          curr.lat
        );
        const fixedRight = snap.width_m / 2;
        const nextW = Math.max(3, Math.min(160, Math.round((fixedRight - lx) * 2) / 2));
        const shiftX = -(nextW - snap.width_m) / 2;
        const [nLng, nLat] = localOffsetToLngLat(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          shiftX,
          0
        );
        onLiveTransform3DRef.current?.({
          width_m: nextW,
          center_lat: Number(nLat.toFixed(6)),
          center_lng: Number(nLng.toFixed(6)),
        });
      }
    );

    // 3: +D (Front/North local edge)
    const frontMarker = createHandleMarker(
      resizeHandleHtml,
      "ลากเพื่อยืด-หดด้านหน้า (ความยาว)",
      22,
      (curr, _start, snap) => {
        const { ly } = lngLatToLocalMeters(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          curr.lng,
          curr.lat
        );
        const fixedBack = -snap.depth_m / 2;
        const nextD = Math.max(3, Math.min(160, Math.round((ly - fixedBack) * 2) / 2));
        const shiftY = (nextD - snap.depth_m) / 2;
        const [nLng, nLat] = localOffsetToLngLat(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          0,
          shiftY
        );
        onLiveTransform3DRef.current?.({
          depth_m: nextD,
          center_lat: Number(nLat.toFixed(6)),
          center_lng: Number(nLng.toFixed(6)),
        });
      }
    );

    // 4: -D (Back/South local edge)
    const backMarker = createHandleMarker(
      resizeHandleHtml,
      "ลากเพื่อยืด-หดด้านหลัง (ความยาว)",
      22,
      (curr, _start, snap) => {
        const { ly } = lngLatToLocalMeters(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          curr.lng,
          curr.lat
        );
        const fixedFront = snap.depth_m / 2;
        const nextD = Math.max(3, Math.min(160, Math.round((fixedFront - ly) * 2) / 2));
        const shiftY = -(nextD - snap.depth_m) / 2;
        const [nLng, nLat] = localOffsetToLngLat(
          snap.center_lat,
          snap.center_lng,
          snap.angle_deg,
          0,
          shiftY
        );
        onLiveTransform3DRef.current?.({
          depth_m: nextD,
          center_lat: Number(nLat.toFixed(6)),
          center_lng: Number(nLng.toFixed(6)),
        });
      }
    );

    // 5: Rotate Handle (Emerald circle 8m outside Front edge)
    const rotateMarker = createHandleMarker(
      `<div style="width:26px;height:26px;border-radius:9999px;background:#059669;border:2.5px solid #FFFFFF;box-shadow:0 3px 8px rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;cursor:grab;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
      </div>`,
      "ลากเพื่อหมุนองศาบล็อก 3D",
      28,
      (curr, _start, snap) => {
        const cosLat = Math.cos((snap.center_lat * Math.PI) / 180);
        const dx = (curr.lng - snap.center_lng) * 111320 * cosLat;
        const dy = (curr.lat - snap.center_lat) * 111320;
        if (Math.hypot(dx, dy) < 1) return;
        const deg = Math.round((Math.atan2(-dx, dy) * 180) / Math.PI);
        onLiveTransform3DRef.current?.({ angle_deg: deg });
      }
    );

    handleMarkersRef.current = [
      moveMarker,
      rightMarker,
      leftMarker,
      frontMarker,
      backMarker,
      rotateMarker,
    ];

    return () => {
      for (const m of handleMarkersRef.current) m.remove();
      handleMarkersRef.current = [];
    };
  }, [selectedIdForHandles, mapReady]);

  // Smoothly update handle positions & rotate guide stem whenever selected3D geometry updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const gSrc = map.getSource("transformGuides") as
      | maplibregl.GeoJSONSource
      | undefined;

    if (
      mode !== "customize_3d" ||
      !selected3D ||
      handleMarkersRef.current.length < 6
    ) {
      gSrc?.setData(EMPTY_FC);
      return;
    }

    const { center_lat, center_lng, width_m, depth_m, angle_deg } = selected3D;
    const hw = width_m / 2;
    const hd = depth_m / 2;

    const pCenter: [number, number] = [center_lng, center_lat];
    const pRight = localOffsetToLngLat(center_lat, center_lng, angle_deg, hw, 0);
    const pLeft = localOffsetToLngLat(center_lat, center_lng, angle_deg, -hw, 0);
    const pFront = localOffsetToLngLat(center_lat, center_lng, angle_deg, 0, hd);
    const pBack = localOffsetToLngLat(center_lat, center_lng, angle_deg, 0, -hd);
    const pRotate = localOffsetToLngLat(
      center_lat,
      center_lng,
      angle_deg,
      0,
      hd + 8
    );

    handleMarkersRef.current[0].setLngLat(pCenter);
    handleMarkersRef.current[1].setLngLat(pRight);
    handleMarkersRef.current[2].setLngLat(pLeft);
    handleMarkersRef.current[3].setLngLat(pFront);
    handleMarkersRef.current[4].setLngLat(pBack);
    handleMarkersRef.current[5].setLngLat(pRotate);

    gSrc?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [pFront, pRotate],
          },
        },
      ],
    });
  }, [mode, selected3D, mapReady]);

  // Update cursor for active editing mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor =
      mode === "add_node" || mode === "customize_3d" ? "crosshair" : "";
  }, [mode, mapReady]);

  // Sync 3D Buildings & Labels
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

    const lblSrc = map.getSource("buildingLabels") as
      | maplibregl.GeoJSONSource
      | undefined;
    lblSrc?.setData({
      type: "FeatureCollection",
      features: boundBuildings.labelFeatures,
    } as unknown as GeoJSON.FeatureCollection);
  }, [boundBuildings, mapReady]);

  // Sync Admin Edges GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const src = map.getSource("adminEdges") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;

    const features: GeoJSON.Feature[] = [];
    for (const edge of edges) {
      const from = nodeById.get(edge.from_node);
      const to = nodeById.get(edge.to_node);
      if (!from || !to) continue;
      features.push({
        type: "Feature",
        properties: {
          id: edge.id,
          is_active: edge.is_active,
          distance_m: edge.distance_m,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [edges, nodeById, mapReady]);

  // Sync Survey Tracks Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const src = map.getSource("adminSurveys") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;

    if (!showSurveys) {
      src.setData(EMPTY_FC);
      return;
    }

    const features: GeoJSON.Feature[] = [];
    for (const track of surveys) {
      const pts = Array.isArray(track.points_json)
        ? track.points_json.filter(
            (p) =>
              Array.isArray(p) &&
              p.length >= 2 &&
              typeof p[0] === "number" &&
              typeof p[1] === "number"
          )
        : [];
      if (pts.length < 2) continue;
      features.push({
        type: "Feature",
        properties: {
          id: track.id,
          name: track.name,
          color: track.color_hex || "#F97316",
          is_splitting: splitTrackId === track.id,
        },
        geometry: {
          type: "LineString",
          coordinates: pts.map(([lat, lng]) => [lng, lat]),
        },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [surveys, showSurveys, splitTrackId, mapReady]);

  // Sync Interactive Admin Node Markers (clickable in all modes!)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const m of nodeMarkersRef.current) m.remove();
    nodeMarkersRef.current = [];

    // Hide node pins in customize_3d mode so clicking 3D buildings/wings is unobstructed
    if (mode === "customize_3d") return;

    for (const node of nodes) {
      const isSelectedSource = selectedSourceNodeId === node.id;
      const size = node.is_building ? 24 : 16;
      const bg = isSelectedSource
        ? "#F59E0B"
        : mode === "delete"
        ? "#DC2626"
        : node.is_building
        ? "#0F766E"
        : "#1D4ED8";

      const el = document.createElement("button");
      el.type = "button";
      el.title = `#${node.id} ${
        node.name || (node.is_building ? "อาคาร" : "จุดแยกทางเดิน")
      }`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.className = "relative flex items-center justify-center cursor-pointer";
      el.innerHTML = `
        ${
          isSelectedSource
            ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:3px solid #F59E0B;opacity:0.9;"></span>`
            : ""
        }
        <span style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(15,23,42,0.45);display:block;"></span>
      `;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onNodeClickRef.current(node);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([node.lng, node.lat])
        .addTo(map);
      nodeMarkersRef.current.push(marker);
    }
  }, [nodes, selectedSourceNodeId, mode, mapReady]);

  const handleToggleTilt = useCallback(() => {
    const map = mapRef.current;
    setIsTilted3D((prev) => {
      const next = !prev;
      map?.easeTo({
        pitch: next ? DEFAULT_3D_PITCH : 0,
        bearing: next ? DEFAULT_3D_BEARING : 0,
        duration: 450,
      });
      return next;
    });
  }, []);

  const handleResetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setIsTilted3D(true);
    map.easeTo({
      center: dataset?.meta.center || DEFAULT_3D_CENTER,
      zoom: DEFAULT_3D_ZOOM,
      pitch: DEFAULT_3D_PITCH,
      bearing: DEFAULT_3D_BEARING,
      duration: 550,
    });
  }, [dataset]);

  return (
    <div className="relative w-full h-full bg-[#E6EDF4]">
      <div ref={containerRef} className="w-full h-full" />

      {!mapReady && (
        <div className="absolute inset-0 z-10 bg-[#E6EDF4] flex flex-col items-center justify-center gap-2 text-slate-600">
          <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
          <span className="text-sm font-semibold">
            กำลังเปิดแผนที่จัดการข้อมูล 3D...
          </span>
        </div>
      )}

      {/* Top-Right Collapsible Layers Popover (collapsed by default for clean full-viewport canvas) */}
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
              controlsOpen || translucentBuildings || !isTilted3D
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>

          {controlsOpen && (
            <div className="absolute top-0 right-12 w-64 rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-xl p-3 space-y-3">
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

              {/* 3-Mode Map Switcher */}
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

              {/* 3D Tools & Refresh */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleTilt}
                  className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    !isTilted3D
                      ? "bg-teal-50 border-teal-200 text-[#0F766E]"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>{isTilted3D ? "มุมบน 2D" : "เอียง 3D"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTranslucentBuildings((prev) => !prev)}
                  className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    translucentBuildings
                      ? "bg-[#0F766E] border-[#0F766E] text-white"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>โปร่งแสงตึก</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleResetView();
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
