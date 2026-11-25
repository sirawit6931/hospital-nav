"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Headphones,
  Loader2,
  Map as MapIcon,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { api, extractApiError, type MapNode, type RouteResponse } from "@/lib/api";
import {
  FILTER_CHIPS,
  HOSPITAL_CENTER,
  calculateDistanceMeters,
  classifyBuilding,
  interpolateAlongPolyline,
  snapToPolyline,
  type FilterCategoryId,
} from "@/lib/hospital";
import HospitalHeader from "@/components/HospitalHeader";
import BuildingCard from "@/components/BuildingCard";
import RoutePanel from "@/components/RoutePanel";
import ServiceDirectory from "@/components/ServiceDirectory";
import ArrivalModal from "@/components/ArrivalModal";

const PublicNavigationMap = dynamic(
  () => import("@/components/maps/PublicNavigationMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center gap-2 text-slate-500">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
        <span className="text-sm font-medium">กำลังโหลดแผนที่ดาวเทียม...</span>
      </div>
    ),
  }
);

type NavTab = "buildings" | "route" | "services";

const SNAP_THRESHOLD_METERS = 15;
const ARRIVAL_THRESHOLD_METERS = 15;
const REROUTE_COOLDOWN_MS = 5000;

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<NavTab>("buildings");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterCategoryId>("all");

  const [buildings, setBuildings] = useState<MapNode[]>([]);
  const [allBuildings, setAllBuildings] = useState<MapNode[]>([]);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(true);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);

  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "locating" | "ready" | "fallback"
  >("idle");
  const [userGpsCoords, setUserGpsCoords] =
    useState<[number, number]>(HOSPITAL_CENTER);

  const [originMode, setOriginMode] = useState<"gps" | "building">("gps");
  const [originBuildingId, setOriginBuildingId] = useState<number | null>(null);
  const [targetBuilding, setTargetBuilding] = useState<MapNode | null>(null);
  const [focusedNode, setFocusedNode] = useState<MapNode | null>(null);

  const [routeData, setRouteData] = useState<RouteResponse | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [isAutoRerouting, setIsAutoRerouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Mock GPS & Walk Simulator state
  const [mockGpsEnabled, setMockGpsEnabled] = useState(false);
  const [isMockWalking, setIsMockWalking] = useState(false);
  const [mockWalkProgress, setMockWalkProgress] = useState(0);

  // Arrival Detection Modal state
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const [hasArrivedCurrentTarget, setHasArrivedCurrentTarget] = useState(false);
  const dismissedArrivalKeyRef = useRef<string | null>(null);

  // Auto-reroute cooldown & concurrency guards
  const lastRerouteAtRef = useRef<number>(0);
  const isFetchingRouteRef = useRef<boolean>(false);

  // Mobile Bottom Sheet expansion state when viewing route map
  const [sheetExpanded, setSheetExpanded] = useState(true);

  const originBuilding = useMemo(
    () => allBuildings.find((b) => b.id === originBuildingId) ?? null,
    [allBuildings, originBuildingId]
  );

  // Raw current origin coordinates before snapping to the active route polyline
  const rawOriginCoords: [number, number] = useMemo(() => {
    if (originMode === "building" && originBuilding) {
      return [originBuilding.lat, originBuilding.lng];
    }
    return userGpsCoords;
  }, [originMode, originBuilding, userGpsCoords]);

  // 1. Snap to Path calculation (snaps within 15m of active Polyline)
  const snapResult = useMemo(() => {
    if (!routeData || !routeData.path || routeData.path.length === 0) {
      return {
        snappedCoords: rawOriginCoords,
        distanceFromPathMeters: 0,
        isSnapped: false,
        isOffRoute: false,
      };
    }
    return snapToPolyline(
      rawOriginCoords,
      routeData.path,
      SNAP_THRESHOLD_METERS
    );
  }, [rawOriginCoords, routeData]);

  const displayOriginCoords = snapResult.snappedCoords;

  // 2. Real-time distance to destination building
  const distanceToTargetMeters = useMemo(() => {
    if (!targetBuilding) return null;
    return calculateDistanceMeters(
      displayOriginCoords[0],
      displayOriginCoords[1],
      targetBuilding.lat,
      targetBuilding.lng
    );
  }, [displayOriginCoords, targetBuilding]);

  const effectiveOriginLabel = useMemo(() => {
    if (mockGpsEnabled) {
      return "พิกัดจำลอง (Mock GPS)";
    }
    if (originMode === "building" && originBuilding) {
      return originBuilding.name;
    }
    return gpsStatus === "ready"
      ? "ตำแหน่งปัจจุบัน (GPS)"
      : "จุดเริ่มต้น รพ.สกลนคร";
  }, [mockGpsEnabled, originMode, originBuilding, gpsStatus]);

  const fetchBuildings = useCallback(async (queryText: string) => {
    setIsLoadingBuildings(true);
    setBuildingsError(null);
    try {
      const res = await api.get<MapNode[]>("/api/buildings", {
        params: queryText ? { q: queryText } : undefined,
      });
      const list = Array.isArray(res.data) ? res.data : [];
      setBuildings(list);
      if (!queryText) {
        setAllBuildings(list);
      }
    } catch (err) {
      setBuildingsError(
        extractApiError(err, "ไม่สามารถดึงรายชื่ออาคารได้ในขณะนี้")
      );
    } finally {
      setIsLoadingBuildings(false);
    }
  }, []);

  const acquireGpsLocation = useCallback(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGpsStatus("fallback");
      return;
    }
    setMockGpsEnabled(false);
    setIsMockWalking(false);
    setGpsStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserGpsCoords([pos.coords.latitude, pos.coords.longitude]);
        setGpsStatus("ready");
      },
      () => {
        setGpsStatus("fallback");
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 10000,
      }
    );
  }, []);

  useEffect(() => {
    fetchBuildings("");
    acquireGpsLocation();
  }, [fetchBuildings, acquireGpsLocation]);

  // Continuous Real-Time GPS Watch while actively navigating (disabled during Mock GPS or Building origin)
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !navigator.geolocation ||
      !targetBuilding ||
      originMode !== "gps" ||
      mockGpsEnabled
    ) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserGpsCoords([pos.coords.latitude, pos.coords.longitude]);
        setGpsStatus("ready");
      },
      () => {
        // Keep last known position gracefully on temporary GPS hiccup
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [targetBuilding, originMode, mockGpsEnabled]);

  const fetchRoute = useCallback(
    async (
      origin: [number, number],
      target: MapNode,
      options?: { isAutoReroute?: boolean }
    ) => {
      if (isFetchingRouteRef.current) return;
      isFetchingRouteRef.current = true;

      if (options?.isAutoReroute) {
        setIsAutoRerouting(true);
      } else {
        setIsLoadingRoute(true);
      }
      setRouteError(null);

      try {
        const res = await api.get<RouteResponse>("/api/route", {
          params: {
            lat: origin[0],
            lng: origin[1],
            target_node_id: target.id,
          },
        });
        setRouteData(res.data);
      } catch (err) {
        if (!options?.isAutoReroute) {
          setRouteData(null);
        }
        setRouteError(
          extractApiError(
            err,
            "ไม่สามารถค้นหาเส้นทางเดินไปยังอาคารปลายทางได้ในขณะนี้"
          )
        );
      } finally {
        isFetchingRouteRef.current = false;
        setIsLoadingRoute(false);
        setIsAutoRerouting(false);
      }
    },
    []
  );

  // Trigger initial route calculation when target or building-origin selection changes
  useEffect(() => {
    if (!targetBuilding) return;
    lastRerouteAtRef.current = Date.now();
    fetchRoute(rawOriginCoords, targetBuilding);
    // Intentionally triggered only when user selects a new target or switches origin mode/building
    // Live GPS movement uses Snap-to-Path & Auto-Reroute below to avoid spamming /api/route
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetBuilding?.id, originMode, originBuildingId]);

  // Auto-Reroute when drifting > 15m off the route Polyline (with 5-second cooldown)
  useEffect(() => {
    if (
      !targetBuilding ||
      !routeData ||
      originMode !== "gps" ||
      isMockWalking ||
      !snapResult.isOffRoute
    ) {
      return;
    }

    // Do not auto-reroute if already arrived at destination
    if (
      distanceToTargetMeters !== null &&
      distanceToTargetMeters < ARRIVAL_THRESHOLD_METERS
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) {
      return;
    }

    lastRerouteAtRef.current = now;
    fetchRoute(rawOriginCoords, targetBuilding, { isAutoReroute: true });
  }, [
    snapResult.isOffRoute,
    rawOriginCoords,
    targetBuilding,
    routeData,
    originMode,
    isMockWalking,
    distanceToTargetMeters,
    fetchRoute,
  ]);

  // Real-time Arrival Detection (< 15 meters from destination building)
  useEffect(() => {
    if (!targetBuilding || distanceToTargetMeters === null) {
      setHasArrivedCurrentTarget(false);
      return;
    }

    const arrivalKey = `${targetBuilding.id}`;
    if (distanceToTargetMeters < ARRIVAL_THRESHOLD_METERS) {
      setHasArrivedCurrentTarget(true);
      setIsMockWalking(false);
      if (dismissedArrivalKeyRef.current !== arrivalKey) {
        setShowArrivalModal(true);
      }
    } else {
      setHasArrivedCurrentTarget(false);
      // Allow modal to show again if user walks away (> 25m) and returns
      if (distanceToTargetMeters > 25 && dismissedArrivalKeyRef.current === arrivalKey) {
        dismissedArrivalKeyRef.current = null;
      }
    }
  }, [distanceToTargetMeters, targetBuilding]);

  // Mock GPS Auto-Walk Playback along active Polyline
  useEffect(() => {
    if (!mockGpsEnabled || !isMockWalking || !routeData?.path || routeData.path.length < 2) {
      return;
    }

    const timer = setInterval(() => {
      setMockWalkProgress((prev) => {
        const next = Math.min(100, prev + 4);
        const nextCoord = interpolateAlongPolyline(routeData.path, next / 100);
        if (nextCoord) {
          setUserGpsCoords(nextCoord);
        }
        if (next >= 100) {
          setIsMockWalking(false);
        }
        return next;
      });
    }, 350);

    return () => clearInterval(timer);
  }, [mockGpsEnabled, isMockWalking, routeData]);

  const handleSelectRoute = useCallback((building: MapNode) => {
    dismissedArrivalKeyRef.current = null;
    setShowArrivalModal(false);
    setHasArrivedCurrentTarget(false);
    setIsMockWalking(false);
    setMockWalkProgress(0);
    setTargetBuilding(building);
    setFocusedNode(building);
    setActiveTab("route");
    setSheetExpanded(true);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    setAppliedQuery(trimmed);
    fetchBuildings(trimmed);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setAppliedQuery("");
    fetchBuildings("");
  };

  const handleChangeOriginMode = (
    mode: "gps" | "building",
    buildingId?: number
  ) => {
    setOriginMode(mode);
    setOriginBuildingId(mode === "building" && buildingId ? buildingId : null);
    if (mode === "building") {
      setIsMockWalking(false);
    }
  };

  const handleSwapOriginAndTarget = () => {
    if (!targetBuilding) return;
    dismissedArrivalKeyRef.current = null;
    setShowArrivalModal(false);
    setIsMockWalking(false);
    setMockWalkProgress(0);

    if (originMode === "building" && originBuilding) {
      const prevOrigin = originBuilding;
      const prevTarget = targetBuilding;
      setOriginBuildingId(prevTarget.id);
      setTargetBuilding(prevOrigin);
    } else {
      const fallbackNext = allBuildings.find((b) => b.id !== targetBuilding.id);
      if (fallbackNext) {
        setOriginMode("building");
        setOriginBuildingId(targetBuilding.id);
        setTargetBuilding(fallbackNext);
      }
    }
  };

  // Mock GPS Handlers
  const handleToggleMockGps = () => {
    setMockGpsEnabled((prev) => {
      const next = !prev;
      if (next) {
        setOriginMode("gps");
        setOriginBuildingId(null);
      } else {
        setIsMockWalking(false);
      }
      return next;
    });
  };

  const handleMockMapClick = useCallback((lat: number, lng: number) => {
    setIsMockWalking(false);
    setOriginMode("gps");
    setOriginBuildingId(null);
    setUserGpsCoords([lat, lng]);
  }, []);

  const handleToggleMockWalk = () => {
    if (!routeData?.path || routeData.path.length < 2) return;
    setOriginMode("gps");
    setOriginBuildingId(null);
    if (mockWalkProgress >= 100) {
      dismissedArrivalKeyRef.current = null;
      setShowArrivalModal(false);
      setMockWalkProgress(0);
      setUserGpsCoords(routeData.path[0]);
      setIsMockWalking(true);
      return;
    }
    setIsMockWalking((prev) => !prev);
  };

  const handleChangeMockProgress = (progressPercent: number) => {
    if (!routeData?.path || routeData.path.length < 2) return;
    setIsMockWalking(false);
    setOriginMode("gps");
    setOriginBuildingId(null);
    setMockWalkProgress(progressPercent);
    const coord = interpolateAlongPolyline(
      routeData.path,
      progressPercent / 100
    );
    if (coord) {
      setUserGpsCoords(coord);
    }
  };

  const handleResetMockWalk = () => {
    if (!routeData?.path || routeData.path.length === 0) return;
    setIsMockWalking(false);
    dismissedArrivalKeyRef.current = null;
    setShowArrivalModal(false);
    setMockWalkProgress(0);
    setUserGpsCoords(routeData.path[0]);
  };

  const filteredBuildings = useMemo(() => {
    if (activeFilter === "all") return buildings;
    return buildings.filter((b) => classifyBuilding(b).category === activeFilter);
  }, [buildings, activeFilter]);

  // Building Search Content (Figma Frame 1)
  const searchContent = (
    <div className="space-y-4">
      {/* Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="พิมพ์ชื่อตึก, แผนก เช่น MICU, ฟอกไต, X-Ray"
            className="w-full min-h-[48px] pl-11 pr-10 rounded-xl bg-white border border-slate-200 text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-teal-600/15"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label="ล้างคำค้นหา"
              className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="min-h-[48px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-semibold shrink-0 shadow-sm transition-colors cursor-pointer"
        >
          ค้นหา
        </button>
      </form>

      {/* Horizontal Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {FILTER_CHIPS.map((chip) => {
          const isActive = activeFilter === chip.id;
          const countSuffix =
            chip.id === "all" && buildings.length > 0
              ? ` (${buildings.length})`
              : "";
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setActiveFilter(chip.id)}
              className={`min-h-[44px] px-4 rounded-full text-sm font-semibold whitespace-nowrap border transition-colors cursor-pointer ${
                isActive
                  ? "bg-[#0F766E] border-[#0F766E] text-white shadow-sm"
                  : "bg-white border-slate-200 text-slate-700 hover:border-teal-300 hover:text-[#0F766E]"
              }`}
            >
              {chip.label}
              {countSuffix}
            </button>
          );
        })}
      </div>

      {/* Building List Header */}
      <div className="flex items-center justify-between pt-1">
        <h2 className="font-heading text-base font-bold text-[#0F172A]">
          รายชื่อตึกและแผนก
          {appliedQuery && (
            <span className="text-sm font-normal text-slate-500 ml-1.5">
              (&ldquo;{appliedQuery}&rdquo;)
            </span>
          )}
        </h2>
        <span className="text-xs font-semibold text-slate-500">
          {filteredBuildings.length} อาคาร
        </span>
      </div>

      {/* Building Cards List */}
      {isLoadingBuildings ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 flex flex-col items-center justify-center gap-2 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-[#0F766E]" />
          <span className="text-sm">กำลังโหลดข้อมูลอาคาร...</span>
        </div>
      ) : buildingsError ? (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-[#BE123C] shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[#BE123C]">
              {buildingsError}
            </p>
            <button
              type="button"
              onClick={() => fetchBuildings(appliedQuery)}
              className="min-h-[40px] px-3.5 rounded-lg bg-white border border-rose-200 text-xs font-bold text-[#BE123C] cursor-pointer"
            >
              ลองใหม่อีกครั้ง
            </button>
          </div>
        </div>
      ) : filteredBuildings.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-7 text-center space-y-2">
          <p className="font-heading text-sm font-bold text-slate-800">
            ไม่พบอาคารหรือแผนกที่ตรงกับเงื่อนไข
          </p>
          <p className="text-xs text-slate-500">
            ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองเป็น &ldquo;ทั้งหมด&rdquo;
          </p>
          {(appliedQuery || activeFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setActiveFilter("all");
                handleClearSearch();
              }}
              className="mt-2 min-h-[44px] px-4 rounded-xl bg-teal-50 text-[#0F766E] text-sm font-semibold cursor-pointer"
            >
              แสดงอาคารทั้งหมด
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 pb-4">
          {filteredBuildings.map((building) => (
            <BuildingCard
              key={building.id}
              building={building}
              originCoords={displayOriginCoords}
              isSelected={targetBuilding?.id === building.id}
              onSelectRoute={handleSelectRoute}
              onFocusOnMap={(b) => setFocusedNode(b)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const arrivalBannerInPanel =
    hasArrivedCurrentTarget && targetBuilding ? (
      <div className="mb-3 rounded-2xl bg-[#CCFBF1] border border-teal-300 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <CheckCircle2 className="w-5 h-5 text-[#047857] shrink-0" />
          <div className="min-w-0">
            <p className="font-heading text-sm font-bold text-[#047857] truncate">
              ถึงจุดหมายแล้ว: {targetBuilding.name}
            </p>
            <p className="text-xs text-teal-900/80">
              ระยะห่าง {Math.max(0, Math.round(distanceToTargetMeters ?? 0))} ม.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowArrivalModal(true)}
          className="min-h-[38px] px-3 rounded-xl bg-[#047857] hover:bg-emerald-800 text-white text-xs font-bold shrink-0 cursor-pointer"
        >
          ดูคำแนะนำตึก
        </button>
      </div>
    ) : null;

  const routePanelProps = {
    buildings: allBuildings.length > 0 ? allBuildings : buildings,
    originLabel: effectiveOriginLabel,
    originMode,
    originBuildingId,
    targetBuilding,
    routeData,
    isLoadingRoute,
    routeError,
    onChangeOriginMode: handleChangeOriginMode,
    onSwapOriginAndTarget: handleSwapOriginAndTarget,
    onPickTargetTab: () => setActiveTab("buildings"),
    onRetryRoute: () => {
      if (targetBuilding) {
        lastRerouteAtRef.current = Date.now();
        fetchRoute(rawOriginCoords, targetBuilding);
      }
    },
  };

  const sharedMapProps = {
    buildings: allBuildings.length > 0 ? allBuildings : buildings,
    displayOriginCoords,
    rawOriginCoords,
    isSnappedToPath: snapResult.isSnapped,
    isAutoRerouting,
    distanceToTargetMeters,
    focusedNode,
    targetBuilding,
    routeData,
    mockGpsEnabled,
    isMockWalking,
    mockWalkProgress,
    onSelectBuilding: handleSelectRoute,
    onLocateMe: acquireGpsLocation,
    onToggleMockGps: handleToggleMockGps,
    onMockMapClick: handleMockMapClick,
    onToggleMockWalk: handleToggleMockWalk,
    onChangeMockProgress: handleChangeMockProgress,
    onResetMockWalk: handleResetMockWalk,
  };

  return (
    <div className="h-dvh w-full overflow-hidden flex flex-col md:flex-row bg-[#F8FAFC]">
      {/* ================= DESKTOP / TABLET LEFT SIDEBAR (420px) ================= */}
      <aside className="hidden md:flex md:w-[420px] md:shrink-0 h-full flex-col border-r border-slate-200 bg-[#F8FAFC]">
        <HospitalHeader gpsStatus={gpsStatus} onLocateMe={acquireGpsLocation} />

        {/* Desktop Tab Bar */}
        <nav
          aria-label="เมนูหลัก"
          className="shrink-0 bg-white border-b border-slate-200 px-3 py-2 grid grid-cols-3 gap-1.5"
        >
          <button
            type="button"
            onClick={() => setActiveTab("buildings")}
            className={`min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "buildings"
                ? "bg-[#CCFBF1] text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Search className="w-4 h-4" />
            <span>ค้นหาตึก</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("route")}
            className={`min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "route"
                ? "bg-[#CCFBF1] text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <MapIcon className="w-4 h-4" />
            <span>เส้นทาง</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("services")}
            className={`min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "services"
                ? "bg-[#CCFBF1] text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Headphones className="w-4 h-4" />
            <span>จุดบริการ</span>
          </button>
        </nav>

        {/* Desktop Scrollable Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "buildings" && searchContent}
          {activeTab === "route" && (
            <>
              {arrivalBannerInPanel}
              <RoutePanel {...routePanelProps} />
            </>
          )}
          {activeTab === "services" && <ServiceDirectory />}
        </div>
      </aside>

      {/* ================= DESKTOP / TABLET RIGHT MAP AREA ================= */}
      <main className="hidden md:block flex-1 h-full relative">
        <PublicNavigationMap {...sharedMapProps} />
      </main>

      {/* ================= MOBILE FULL-EXPERIENCE WEB APP (< 768px) ================= */}
      <div className="flex md:hidden flex-col h-dvh w-full overflow-hidden">
        <HospitalHeader gpsStatus={gpsStatus} onLocateMe={acquireGpsLocation} />

        {/* Mobile Main Stage */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          {activeTab === "buildings" && (
            <div className="h-full overflow-y-auto p-4">{searchContent}</div>
          )}

          {activeTab === "services" && (
            <div className="h-full overflow-y-auto p-4">
              <ServiceDirectory />
            </div>
          )}

          {activeTab === "route" && (
            <div className="h-full w-full relative flex flex-col">
              {/* Full-screen Map behind Bottom Sheet */}
              <div className="flex-1 relative min-h-0">
                <PublicNavigationMap {...sharedMapProps} />

                {/* Mobile Slide-Up Bottom Sheet */}
                <div
                  className={`absolute inset-x-0 bottom-0 z-[500] bg-[#F8FAFC] rounded-t-3xl border-t border-slate-200 shadow-[0_-10px_30px_rgba(15,23,42,0.18)] transition-all duration-300 flex flex-col ${
                    sheetExpanded ? "max-h-[72%]" : "max-h-[112px]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSheetExpanded((prev) => !prev)}
                    className="w-full pt-2.5 pb-2 px-4 flex flex-col items-center gap-1 shrink-0 cursor-pointer"
                    aria-label={
                      sheetExpanded
                        ? "ย่อแผงรายละเอียดเส้นทาง"
                        : "ขยายแผงรายละเอียดเส้นทาง"
                    }
                  >
                    <span className="w-10 h-1.5 rounded-full bg-slate-300" />
                    <div className="w-full flex items-center justify-between pt-1">
                      <span className="font-heading text-sm font-bold text-[#0F172A] truncate">
                        {routeData
                          ? `${routeData.target_building.name} • ${Math.max(
                              1,
                              Math.round(routeData.estimated_walk_min)
                            )} นาที (${Math.round(
                              routeData.total_distance_m
                            )} ม.)`
                          : targetBuilding
                          ? targetBuilding.name
                          : "รายละเอียดเส้นทางเดิน"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#0F766E] shrink-0">
                        {sheetExpanded ? (
                          <>
                            <span>ดูแผนที่</span>
                            <ChevronDown className="w-4 h-4" />
                          </>
                        ) : (
                          <>
                            <span>รายละเอียด</span>
                            <ChevronUp className="w-4 h-4" />
                          </>
                        )}
                      </span>
                    </div>
                  </button>

                  {sheetExpanded && (
                    <div className="overflow-y-auto px-4 pb-4 flex-1">
                      {arrivalBannerInPanel}
                      <RoutePanel {...routePanelProps} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <nav
          aria-label="แถบเมนูล่าง"
          className="shrink-0 bg-white border-t border-slate-200 px-2 py-1.5 grid grid-cols-3 gap-1.5 shadow-[0_-2px_10px_rgba(15,23,42,0.05)]"
        >
          <button
            type="button"
            onClick={() => setActiveTab("buildings")}
            className={`min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === "buildings"
                ? "bg-[#CCFBF1] text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Search className="w-5 h-5" />
            <span>ค้นหาตึก</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("route")}
            className={`min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === "route"
                ? "bg-[#CCFBF1] text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <MapIcon className="w-5 h-5" />
            <span>เส้นทาง</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("services")}
            className={`min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors cursor-pointer ${
              activeTab === "services"
                ? "bg-[#CCFBF1] text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Headphones className="w-5 h-5" />
            <span>จุดบริการ</span>
          </button>
        </nav>
      </div>

      {/* Real-time Arrival Detection Modal (< 15m from destination) */}
      {showArrivalModal && targetBuilding && (
        <ArrivalModal
          building={routeData?.target_building ?? targetBuilding}
          distanceMeters={distanceToTargetMeters ?? 0}
          onClose={() => {
            dismissedArrivalKeyRef.current = `${targetBuilding.id}`;
            setShowArrivalModal(false);
          }}
          onSearchAnother={() => {
            dismissedArrivalKeyRef.current = `${targetBuilding.id}`;
            setShowArrivalModal(false);
            setActiveTab("buildings");
          }}
        />
      )}
    </div>
  );
}
