"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  Box,
  Eye,
  Globe,
  Loader2,
  Map as MapIcon,
  RotateCcw,
} from "lucide-react";
import type { MapEdge, MapNode, SurveyTrack } from "@/lib/api";
import {
  bindMapNodesTo3DBuildings,
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
  onMapClick: (lat: number, lng: number) => void;
  onNodeClick: (node: MapNode) => void;
  onEdgeClick: (edge: MapEdge) => void;
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

export default function Admin3DMapEditor({
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
}: Admin3DMapEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const nodeMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [dataset, setDataset] = useState<SakonHospital3DDataset | null>(
    cachedAdmin3DDataset
  );
  const [mapReady, setMapReady] = useState(false);
  const [isTilted3D, setIsTilted3D] = useState(true);
  const [translucentBuildings, setTranslucentBuildings] = useState(true);

  const modeRef = useRef(mode);
  const onMapClickRef = useRef(onMapClick);
  const onNodeClickRef = useRef(onNodeClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  const edgesByIdRef = useRef<Map<number, MapEdge>>(new Map());

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
    return bindMapNodesTo3DBuildings(
      dataset,
      buildingNodes,
      null,
      null,
      translucentBuildings
    );
  }, [dataset, buildingNodes, translucentBuildings]);

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
          // Survey tracks (Orange overlay)
          {
            id: "admin-surveys-line",
            type: "line",
            source: "adminSurveys",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#F97316",
              "line-width": 5,
              "line-opacity": 0.9,
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
          // Solid 3D Buildings (opacity 0.88)
          {
            id: "buildings-3d-solid",
            type: "fill-extrusion",
            source: "buildings",
            filter: ["!=", ["get", "route_through"], true],
            paint: {
              "fill-extrusion-color": ["coalesce", ["get", "color"], "#94A3B8"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.88,
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
              "fill-extrusion-color": ["coalesce", ["get", "color"], "#94A3B8"],
              "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.35,
              "fill-extrusion-vertical-gradient": true,
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

    map.on("click", (e) => {
      if (modeRef.current !== "add_node") return;
      onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
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
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [dataset]);

  // Update cursor for active editing mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor = mode === "add_node" ? "crosshair" : "";
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
        properties: { id: track.id, name: track.name },
        geometry: {
          type: "LineString",
          coordinates: pts.map(([lat, lng]) => [lng, lat]),
        },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [surveys, showSurveys, mapReady]);

  // Sync Interactive Admin Node Markers (clickable in all modes!)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const m of nodeMarkersRef.current) m.remove();
    nodeMarkersRef.current = [];

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

      {/* Top-Right Controls: 3-Mode Switcher + 3D Tilt + Translucent X-Ray + Reset */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-2">
        <div
          role="group"
          aria-label="เลือกโหมดแผนที่ผู้ดูแล"
          className="inline-flex items-center p-1 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md"
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

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleTilt}
            className="min-h-[40px] px-3 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-slate-50 text-xs font-bold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
          >
            <Box className="w-4 h-4 text-[#0F766E]" />
            <span>{isTilted3D ? "มุมบน 2D" : "เอียง 3D"}</span>
          </button>

          <button
            type="button"
            onClick={() => setTranslucentBuildings((prev) => !prev)}
            title="ปรับความโปร่งแสงตึกเพื่อวางจุดและเชื่อมเส้นทางชั้นล่างได้สะดวก"
            className={`min-h-[40px] px-3 rounded-xl border shadow-md text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              translucentBuildings
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:bg-teal-50"
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>โปร่งแสงตึก</span>
          </button>

          <button
            type="button"
            onClick={handleResetView}
            title="รีเซ็ตมุมกล้อง"
            className="min-h-[40px] min-w-[40px] rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-md hover:bg-slate-50 text-slate-700 flex items-center justify-center cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
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
