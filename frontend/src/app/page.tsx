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
  Navigation,
  QrCode,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  api,
  extractApiError,
  type Announcement,
  type Category,
  type MapNode,
  type RouteResponse,
  type ServicePoint,
} from "@/lib/api";
import {
  FILTER_CHIPS,
  HOSPITAL_CENTER,
  calculateBearing,
  calculateDistanceMeters,
  classifyBuilding,
  computeCompassHeadingFromOrientation,
  interpolateAlongPolyline,
  snapToPolyline,
  type FilterCategoryId,
  type FilterChipOption,
} from "@/lib/hospital";
import type { MapViewMode } from "@/lib/hospital3d";
import {
  buildActiveNavigationSteps,
  computeRouteProgress,
  speakThaiNavigation,
  stopThaiNavigationSpeech,
} from "@/lib/navigation";
import { rankBuildingsByQuery } from "@/lib/search";
import HospitalHeader from "@/components/HospitalHeader";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import BuildingSearchBar from "@/components/BuildingSearchBar";
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

const Public3DMap = dynamic(
  () => import("@/components/maps/Public3DMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#E6EDF4] flex flex-col items-center justify-center gap-2 text-slate-600">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
        <span className="text-sm font-medium">กำลังโหลดแผนที่ 3D โรงพยาบาลสกลนคร...</span>
      </div>
    ),
  }
);

type NavTab = "buildings" | "route" | "services";

const SNAP_THRESHOLD_METERS = 15;
const ARRIVAL_THRESHOLD_METERS = 15;
const REROUTE_COOLDOWN_MS = 5000;

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<NavTab>("route");
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>("3d");
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(true);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterCategoryId>("all");

  const [buildings, setBuildings] = useState<MapNode[]>([]);
  const [allBuildings, setAllBuildings] = useState<MapNode[]>([]);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState(true);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);

  // Live API-driven public metadata (categories, service points, announcements, QR start_node)
  const [categories, setCategories] = useState<Category[]>([]);
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [qrOriginNode, setQrOriginNode] = useState<MapNode | null>(null);
  const [qrBannerDismissed, setQrBannerDismissed] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);
  const hasQrStartNodeRef = useRef<boolean>(false);
  const previewVersionIdRef = useRef<number | null>(null);

  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "locating" | "ready" | "fallback"
  >("idle");
  const [userGpsCoords, setUserGpsCoords] =
    useState<[number, number]>(HOSPITAL_CENTER);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number>(0);
  const [followUser, setFollowUser] = useState<boolean>(false);
  const [headingUpMode, setHeadingUpMode] = useState<boolean>(false);
  const [locateTrigger, setLocateTrigger] = useState<number>(0);
  const [compassPermissionVersion, setCompassPermissionVersion] = useState<number>(0);
  const hasAbsoluteCompassRef = useRef<boolean>(false);
  const lastCompassAtRef = useRef<number>(0);
  const hasInitialGpsFixRef = useRef<boolean>(false);
  const lastGoodAccuracyRef = useRef<number>(999);
  const prevMovementCoordsRef = useRef<[number, number]>(HOSPITAL_CENTER);

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

  // Active Turn-by-Turn Navigation Mode (Google Maps style)
  const [isNavigating, setIsNavigating] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isSimulatingWalk, setIsSimulatingWalk] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const simDistanceRef = useRef<number>(0);
  const spokenKeysRef = useRef<Set<string>>(new Set());

  // Arrival Detection Modal state
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const [hasArrivedCurrentTarget, setHasArrivedCurrentTarget] = useState(false);
  const dismissedArrivalKeyRef = useRef<string | null>(null);

  // Auto-reroute cooldown & AbortController to cancel stale /api/route requests on rapid building switches
  const lastRerouteAtRef = useRef<number>(0);
  const routeAbortControllerRef = useRef<AbortController | null>(null);

  // Mobile Bottom Sheet expansion state when viewing route map
  const [sheetExpanded, setSheetExpanded] = useState(true);

  const originBuilding = useMemo(() => {
    if (originBuildingId === null) return null;
    const fromBuildings = allBuildings.find((b) => b.id === originBuildingId);
    if (fromBuildings) return fromBuildings;
    if (qrOriginNode && qrOriginNode.id === originBuildingId) {
      return qrOriginNode;
    }
    return null;
  }, [allBuildings, originBuildingId, qrOriginNode]);

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

  // Active Turn-by-Turn Steps & Live Progression (passed vs remaining path, distance to next turn, ETA)
  const navSteps = useMemo(
    () => buildActiveNavigationSteps(routeData),
    [routeData]
  );

  const navProgress = useMemo(() => {
    if (!routeData?.path || routeData.path.length === 0 || navSteps.length === 0) {
      return null;
    }
    return computeRouteProgress(
      rawOriginCoords,
      routeData.path,
      navSteps,
      ARRIVAL_THRESHOLD_METERS
    );
  }, [rawOriginCoords, routeData, navSteps]);

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
      const params: Record<string, string | number> = {};
      if (queryText) params.q = queryText;
      if (previewVersionIdRef.current) {
        params.preview_version_id = previewVersionIdRef.current;
      }
      const res = await api.get<MapNode[]>("/api/buildings", {
        params: Object.keys(params).length > 0 ? params : undefined,
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

  const fetchPublicMetadata = useCallback(async () => {
    setIsLoadingServices(true);
    setServicesError(null);
    const [catResult, spResult, annResult] = await Promise.allSettled([
      api.get<Category[]>("/api/categories"),
      api.get<ServicePoint[]>("/api/service-points"),
      api.get<Announcement[]>("/api/announcements"),
    ]);

    if (catResult.status === "fulfilled" && Array.isArray(catResult.value.data)) {
      setCategories(catResult.value.data);
    }

    if (spResult.status === "fulfilled" && Array.isArray(spResult.value.data)) {
      setServicePoints(spResult.value.data);
    } else if (spResult.status === "rejected") {
      setServicesError(
        extractApiError(spResult.reason, "ไม่สามารถโหลดข้อมูลจุดบริการได้ในขณะนี้")
      );
    }
    setIsLoadingServices(false);

    if (annResult.status === "fulfilled" && Array.isArray(annResult.value.data)) {
      setAnnouncements(annResult.value.data);
    }
  }, []);

  const applyLiveGpsPosition = useCallback((pos: GeolocationPosition) => {
    const rawLat = pos.coords.latitude;
    const rawLng = pos.coords.longitude;
    const accuracy =
      typeof pos.coords.accuracy === "number" && !Number.isNaN(pos.coords.accuracy)
        ? pos.coords.accuracy
        : 25;

    setGpsAccuracyMeters(Math.round(accuracy));
    setGpsStatus("ready");

    // Reject sudden noisy indoor GPS outliers (> 65m) once we already have an accurate lock
    if (
      hasInitialGpsFixRef.current &&
      accuracy > 65 &&
      lastGoodAccuracyRef.current <= 30
    ) {
      return;
    }

    if (accuracy < lastGoodAccuracyRef.current) {
      lastGoodAccuracyRef.current = accuracy;
    }

    setUserGpsCoords((prev) => {
      if (!hasInitialGpsFixRef.current) {
        hasInitialGpsFixRef.current = true;
        prevMovementCoordsRef.current = [rawLat, rawLng];
        return [rawLat, rawLng];
      }

      const jumpMeters = calculateDistanceMeters(
        prev[0],
        prev[1],
        rawLat,
        rawLng
      );

      // Adaptive smoothing: suppress standing-still jitter while staying instant when walking
      let alpha = 1;
      if (jumpMeters < 1.2 && accuracy > 8) {
        alpha = 0.25;
      } else if (jumpMeters < 8) {
        alpha = 0.65;
      }

      return [
        prev[0] + (rawLat - prev[0]) * alpha,
        prev[1] + (rawLng - prev[1]) * alpha,
      ];
    });

    // Use GPS course heading as fallback when walking (>= 0.5 m/s) and no live compass signal
    const hasFreshCompass =
      hasAbsoluteCompassRef.current &&
      Date.now() - lastCompassAtRef.current < 4000;
    const speed = typeof pos.coords.speed === "number" ? pos.coords.speed : 0;
    if (
      !hasFreshCompass &&
      typeof pos.coords.heading === "number" &&
      !Number.isNaN(pos.coords.heading) &&
      pos.coords.heading >= 0 &&
      (speed >= 0.5 || pos.coords.speed === null)
    ) {
      const gpsHeading = ((pos.coords.heading % 360) + 360) % 360;
      setUserHeadingDeg((prev) => {
        const diff = ((gpsHeading - prev + 540) % 360) - 180;
        return ((prev + diff * 0.45) % 360 + 360) % 360;
      });
    }
  }, []);

  const requestCompassPermission = useCallback(() => {
    if (typeof window === "undefined") return;
    const DeviceOrientationWithPermission = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<"granted" | "denied">;
        })
      | undefined;
    if (typeof DeviceOrientationWithPermission?.requestPermission === "function") {
      DeviceOrientationWithPermission.requestPermission()
        .then((res) => {
          if (res === "granted") {
            setCompassPermissionVersion((v) => v + 1);
          }
        })
        .catch(() => {
          // Ignore if declined or not triggered from user gesture
        });
    }
  }, []);

  const acquireGpsLocation = useCallback(
    (fromUserGesture = false) => {
      if (typeof window === "undefined") return;

      if (fromUserGesture) {
        requestCompassPermission();
        setFollowUser(true);
        setLocateTrigger((n) => n + 1);
      }

      if (!navigator.geolocation) {
        setGpsStatus("fallback");
        return;
      }
      setMockGpsEnabled(false);
      setIsMockWalking(false);
      if (fromUserGesture || !hasQrStartNodeRef.current) {
        setOriginMode("gps");
        setOriginBuildingId(null);
      }
      if (!hasInitialGpsFixRef.current) {
        setGpsStatus("locating");
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyLiveGpsPosition(pos);
          if (fromUserGesture) {
            setLocateTrigger((n) => n + 1);
          }
        },
        () => {
          if (!hasInitialGpsFixRef.current) {
            setGpsStatus("fallback");
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );
    },
    [applyLiveGpsPosition, requestCompassPermission]
  );

  const handleLocateMeClick = useCallback(() => {
    acquireGpsLocation(true);
  }, [acquireGpsLocation]);

  const handleToggleHeadingUp = useCallback(() => {
    requestCompassPermission();
    setHeadingUpMode((prev) => {
      const next = !prev;
      if (next) {
        setFollowUser(true);
      }
      return next;
    });
  }, [requestCompassPermission]);

  useEffect(() => {
    // Check QR Code deep-link (?start_node=ID) & Admin Draft Preview (?preview_version_id=ID)
    let qrNodeId: number | null = null;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const previewParam = params.get("preview_version_id");
      if (previewParam) {
        const parsedPreview = Number(previewParam);
        if (Number.isInteger(parsedPreview) && parsedPreview > 0) {
          previewVersionIdRef.current = parsedPreview;
          setPreviewVersionId(parsedPreview);
        }
      }
      const startParam = params.get("start_node");
      if (startParam) {
        const parsed = Number(startParam);
        if (Number.isInteger(parsed) && parsed > 0) {
          qrNodeId = parsed;
          hasQrStartNodeRef.current = true;
        }
      }
    }

    fetchBuildings("");
    fetchPublicMetadata();
    acquireGpsLocation(false);

    if (qrNodeId !== null) {
      api
        .get<MapNode>(`/api/nodes/${qrNodeId}`)
        .then((res) => {
          const node = res.data;
          if (node && node.id) {
            setQrOriginNode(node);
            setQrBannerDismissed(false);
            setOriginMode("building");
            setOriginBuildingId(node.id);
            setFocusedNode(node);
          }
        })
        .catch(() => {
          hasQrStartNodeRef.current = false;
        });
    }
  }, [fetchBuildings, fetchPublicMetadata, acquireGpsLocation]);

  // Track desktop vs mobile breakpoint so only one WebGL/Leaflet map mounts at a time
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktopViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Continuous Real-Time GPS Watch whenever in live GPS mode (paused during Mock GPS or Simulate Walk)
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !navigator.geolocation ||
      originMode !== "gps" ||
      mockGpsEnabled ||
      isSimulatingWalk
    ) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        applyLiveGpsPosition(pos);
      },
      () => {
        // Keep last known position gracefully on temporary GPS hiccup
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [originMode, mockGpsEnabled, applyLiveGpsPosition]);

  // Real-time True-North Tilt-Compensated Compass (Android deviceorientationabsolute + iOS webkitCompassHeading)
  useEffect(() => {
    if (typeof window === "undefined" || mockGpsEnabled) return;

    const applyCompassReading = (heading: number) => {
      hasAbsoluteCompassRef.current = true;
      lastCompassAtRef.current = Date.now();
      const normalized = ((heading % 360) + 360) % 360;

      setUserHeadingDeg((prev) => {
        const diff = ((normalized - prev + 540) % 360) - 180;
        if (Math.abs(diff) < 1.2) return prev;
        return ((prev + diff * 0.32) % 360 + 360) % 360;
      });
    };

    const handleAbsoluteOrientation = (ev: DeviceOrientationEvent) => {
      const heading = computeCompassHeadingFromOrientation(ev);
      if (heading !== null) {
        applyCompassReading(heading);
      }
    };

    const handleStandardOrientation = (ev: DeviceOrientationEvent) => {
      // Only accept iOS webkitCompassHeading or events explicitly marked absolute === true.
      // Never accept non-absolute Android deviceorientation (its 0 deg is NOT North!).
      const heading = computeCompassHeadingFromOrientation(ev);
      if (heading !== null) {
        applyCompassReading(heading);
      }
    };

    window.addEventListener(
      "deviceorientationabsolute",
      handleAbsoluteOrientation as EventListener,
      true
    );
    window.addEventListener("deviceorientation", handleStandardOrientation, true);

    return () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        handleAbsoluteOrientation as EventListener,
        true
      );
      window.removeEventListener(
        "deviceorientation",
        handleStandardOrientation,
        true
      );
    };
  }, [mockGpsEnabled, compassPermissionVersion]);

  // Update heading automatically from walking movement vector (used in Mock GPS or devices without magnetometer)
  useEffect(() => {
    const prev = prevMovementCoordsRef.current;
    const moved = calculateDistanceMeters(
      prev[0],
      prev[1],
      displayOriginCoords[0],
      displayOriginCoords[1]
    );
    if (moved >= 2.0) {
      const hasFreshCompass =
        hasAbsoluteCompassRef.current &&
        Date.now() - lastCompassAtRef.current < 4000;
      if (mockGpsEnabled || !hasFreshCompass) {
        const moveBearing = calculateBearing(
          prev[0],
          prev[1],
          displayOriginCoords[0],
          displayOriginCoords[1]
        );
        setUserHeadingDeg((prevDeg) => {
          const diff = ((moveBearing - prevDeg + 540) % 360) - 180;
          return ((prevDeg + diff * 0.65) % 360 + 360) % 360;
        });
      }
      prevMovementCoordsRef.current = displayOriginCoords;
    }
  }, [displayOriginCoords, mockGpsEnabled]);

  // Point directional triangle along the start of a newly loaded route when standing still without compass
  useEffect(() => {
    const hasFreshCompass =
      hasAbsoluteCompassRef.current &&
      Date.now() - lastCompassAtRef.current < 4000;
    if (hasFreshCompass && !mockGpsEnabled) return;
    if (routeData?.path && routeData.path.length >= 2) {
      const [p0, p1] = routeData.path;
      setUserHeadingDeg(calculateBearing(p0[0], p0[1], p1[0], p1[1]));
    }
  }, [routeData, mockGpsEnabled]);

  const fetchRoute = useCallback(
    async (
      origin: [number, number],
      target: MapNode,
      options?: { isAutoReroute?: boolean; startNodeId?: number | null }
    ) => {
      // Cancel any in-flight /api/route request immediately so rapid building clicks never race
      if (routeAbortControllerRef.current) {
        routeAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      routeAbortControllerRef.current = controller;

      if (options?.isAutoReroute) {
        setIsAutoRerouting(true);
      } else {
        setIsLoadingRoute(true);
      }
      setRouteError(null);

      try {
        const params: Record<string, number> = {
          lat: origin[0],
          lng: origin[1],
          target_node_id: target.id,
        };
        if (options?.startNodeId && options.startNodeId > 0) {
          params.start_node_id = options.startNodeId;
        }
        if (previewVersionIdRef.current) {
          params.preview_version_id = previewVersionIdRef.current;
        }
        const res = await api.get<RouteResponse>("/api/route", {
          params,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRouteData(res.data);
      } catch (err: unknown) {
        const maybeErr = err as { code?: string; name?: string };
        if (
          controller.signal.aborted ||
          maybeErr?.code === "ERR_CANCELED" ||
          maybeErr?.name === "CanceledError" ||
          maybeErr?.name === "AbortError"
        ) {
          return;
        }
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
        if (routeAbortControllerRef.current === controller) {
          routeAbortControllerRef.current = null;
          setIsLoadingRoute(false);
          setIsAutoRerouting(false);
        }
      }
    },
    []
  );

  // Trigger initial route calculation when target or building-origin selection changes
  useEffect(() => {
    if (!targetBuilding) return;
    lastRerouteAtRef.current = Date.now();
    fetchRoute(rawOriginCoords, targetBuilding, {
      startNodeId: originMode === "building" ? originBuildingId : null,
    });
    return () => {
      routeAbortControllerRef.current?.abort();
    };
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
      isSimulatingWalk ||
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
      setIsSimulatingWalk(false);
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

  // Active Navigation: Smooth 1.4 m/s Simulate Walk along real route path (for Desktop testing)
  useEffect(() => {
    if (!isNavigating || !isSimulatingWalk || !routeData?.path || routeData.path.length < 2) {
      return;
    }
    const totalDistM = Math.max(1, navProgress?.totalDistanceM ?? routeData.total_distance_m ?? 1);
    const tickMs = 100;
    const stepMetersPerTick = 1.4 * (tickMs / 1000); // 1.4 m/s realistic walking speed

    const timer = setInterval(() => {
      const nextDist = Math.min(totalDistM, simDistanceRef.current + stepMetersPerTick);
      const prevCoord = interpolateAlongPolyline(
        routeData.path,
        simDistanceRef.current / totalDistM
      );
      const nextCoord = interpolateAlongPolyline(
        routeData.path,
        nextDist / totalDistM
      );
      simDistanceRef.current = nextDist;

      if (nextCoord) {
        setUserGpsCoords(nextCoord);
        if (prevCoord) {
          const moved = calculateDistanceMeters(
            prevCoord[0],
            prevCoord[1],
            nextCoord[0],
            nextCoord[1]
          );
          if (moved >= 0.05) {
            setUserHeadingDeg(
              calculateBearing(prevCoord[0], prevCoord[1], nextCoord[0], nextCoord[1])
            );
          }
        }
      }

      if (nextDist >= totalDistM) {
        setIsSimulatingWalk(false);
      }
    }, tickMs);

    return () => clearInterval(timer);
  }, [isNavigating, isSimulatingWalk, routeData, navProgress?.totalDistanceM]);

  // Active Navigation: Thai Voice Guidance (speaks once per approaching turn <= 15m & on arrival)
  useEffect(() => {
    if (!isNavigating || !voiceEnabled || !navProgress || !routeData) return;

    const routeKey = `${routeData.target_building.id}-${routeData.path.length}-${Math.round(
      routeData.total_distance_m
    )}`;

    if (navProgress.hasArrived) {
      const arriveKey = `${routeKey}-arrive`;
      if (!spokenKeysRef.current.has(arriveKey)) {
        spokenKeysRef.current.add(arriveKey);
        speakThaiNavigation(
          `ถึงจุดหมายแล้ว ${routeData.target_building.name}`,
          voiceEnabled
        );
      }
      return;
    }

    if (
      navProgress.nextStep &&
      navProgress.nextStep.direction !== "arrive" &&
      navProgress.distanceToNextTurnM <= 15
    ) {
      const turnKey = `${routeKey}-turn-${navProgress.nextStep.index}`;
      if (!spokenKeysRef.current.has(turnKey)) {
        spokenKeysRef.current.add(turnKey);
        const distSpeech =
          navProgress.distanceToNextTurnM <= 3
            ? ""
            : `อีก ${navProgress.distanceToNextTurnM} เมตร `;
        speakThaiNavigation(
          `${distSpeech}${navProgress.nextStep.instruction}`,
          voiceEnabled
        );
      }
    }
  }, [isNavigating, voiceEnabled, navProgress, routeData]);

  // Cleanup voice synthesis on unmount
  useEffect(() => {
    return () => {
      stopThaiNavigationSpeech();
    };
  }, []);

  const handleStartNavigation = useCallback(() => {
    if (!routeData || !targetBuilding) return;
    requestCompassPermission();
    dismissedArrivalKeyRef.current = null;
    setShowArrivalModal(false);
    setHasArrivedCurrentTarget(false);
    setIsMockWalking(false);
    setIsSimulatingWalk(false);
    setMockGpsEnabled(false);
    spokenKeysRef.current.clear();

    // If starting from a chosen building origin, place starting point cleanly at route start
    if (originMode === "building" && routeData.path.length > 0) {
      setOriginMode("gps");
      setOriginBuildingId(null);
      setUserGpsCoords(routeData.path[0]);
    }
    simDistanceRef.current = 0;

    setActiveTab("route");
    setSheetExpanded(false);
    setFollowUser(true);
    setHeadingUpMode(true);
    setIsNavigating(true);

    const firstInstruction = navSteps[0]?.instruction || "เดินตรงไปตามเส้นทาง";
    const startKey = `${routeData.target_building.id}-start`;
    spokenKeysRef.current.add(startKey);
    speakThaiNavigation(
      `เริ่มนำทางไปยัง ${routeData.target_building.name} ${firstInstruction}`,
      voiceEnabled
    );
  }, [
    routeData,
    targetBuilding,
    originMode,
    navSteps,
    voiceEnabled,
    requestCompassPermission,
  ]);

  const handleEndNavigation = useCallback(() => {
    setIsNavigating(false);
    setIsSimulatingWalk(false);
    setFollowUser(false);
    setHeadingUpMode(false);
    stopThaiNavigationSpeech();
  }, []);

  const handleRecenterNavigation = useCallback(() => {
    setFollowUser(true);
    setHeadingUpMode(true);
    setRecenterTrigger((n) => n + 1);
  }, []);

  const handleToggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      if (!next) {
        stopThaiNavigationSpeech();
      }
      return next;
    });
  }, []);

  const handleToggleSimulateWalk = useCallback(() => {
    if (!routeData?.path || routeData.path.length < 2) return;
    setIsSimulatingWalk((prev) => {
      const next = !prev;
      if (next) {
        setOriginMode("gps");
        setOriginBuildingId(null);
        setMockGpsEnabled(false);
        setIsMockWalking(false);
        setFollowUser(true);
        setHeadingUpMode(true);
        const totalM = navProgress?.totalDistanceM ?? routeData.total_distance_m ?? 0;
        const currM = navProgress?.traveledDistanceM ?? 0;
        if (navProgress?.hasArrived || currM >= totalM - 5) {
          // Restart simulation cleanly from the beginning of the route
          simDistanceRef.current = 0;
          dismissedArrivalKeyRef.current = null;
          setShowArrivalModal(false);
          spokenKeysRef.current.clear();
          setUserGpsCoords(routeData.path[0]);
        } else {
          simDistanceRef.current = currM;
        }
      }
      return next;
    });
  }, [routeData, navProgress]);

  const handleSelectRoute = useCallback((building: MapNode) => {
    dismissedArrivalKeyRef.current = null;
    setShowArrivalModal(false);
    setHasArrivedCurrentTarget(false);
    setIsMockWalking(false);
    setIsSimulatingWalk(false);
    setIsNavigating(false);
    stopThaiNavigationSpeech();
    setMockWalkProgress(0);
    setFocusedNode(null);
    setTargetBuilding(building);
    setActiveTab("route");
    setSheetExpanded(true);
  }, []);

  const handleNavigateToServiceNode = useCallback(
    async (nodeId: number) => {
      const source = allBuildings.length > 0 ? allBuildings : buildings;
      const existing = source.find((b) => b.id === nodeId);
      if (existing) {
        handleSelectRoute(existing);
        return;
      }
      try {
        const res = await api.get<MapNode>(`/api/nodes/${nodeId}`);
        if (res.data && res.data.id) {
          handleSelectRoute(res.data);
        }
      } catch {
        // Ignore if node no longer exists
      }
    },
    [allBuildings, buildings, handleSelectRoute]
  );

  const handleSearchSubmit = (query: string) => {
    const trimmed = query.trim();
    setAppliedQuery(trimmed);
    if (trimmed) {
      setActiveFilter("all");
    }
    fetchBuildings(trimmed);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setAppliedQuery("");
    fetchBuildings("");
  };

  const handleSelectSuggestion = (building: MapNode, fillText: string) => {
    setSearchInput(fillText);
    setAppliedQuery(fillText);
    setActiveFilter("all");
    setFocusedNode(building);
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

  // Dynamic filter chips built from GET /api/categories (with graceful fallback)
  const filterChips = useMemo<FilterChipOption[]>(() => {
    if (categories.length === 0) return FILTER_CHIPS;
    return [
      { id: "all", label: "ทั้งหมด" },
      ...categories.map((cat) => ({
        id: cat.slug,
        label: cat.name,
        colorHex: cat.color_hex,
      })),
    ];
  }, [categories]);

  // Live ranked building list: filters instantly as user types (including fuzzy/near matches & departments)
  const filteredBuildings = useMemo(() => {
    const sourceList = allBuildings.length > 0 ? allBuildings : buildings;
    const liveQuery = searchInput.trim();

    if (liveQuery) {
      const ranked = rankBuildingsByQuery(sourceList, liveQuery).map(
        (m) => m.building
      );
      if (activeFilter === "all") return ranked;
      const inCategory = ranked.filter(
        (b) => classifyBuilding(b, categories).category === activeFilter
      );
      // If user typed a department outside current chip, show the ranked matches cleanly
      return inCategory.length > 0 ? inCategory : ranked;
    }

    if (activeFilter === "all") return sourceList;
    return sourceList.filter(
      (b) => classifyBuilding(b, categories).category === activeFilter
    );
  }, [allBuildings, buildings, searchInput, activeFilter, categories]);

  const qrOriginNotice =
    qrOriginNode &&
    originMode === "building" &&
    originBuildingId === qrOriginNode.id &&
    !qrBannerDismissed ? (
      <div className="mb-3 rounded-2xl bg-teal-50 border border-teal-200 px-3.5 py-2.5 flex items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0F766E] text-white flex items-center justify-center shrink-0">
            <QrCode className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#0F766E]">
              ตั้งจุดเริ่มต้นจาก QR Code แล้ว
            </p>
            <p className="text-xs text-slate-700 truncate">
              {qrOriginNode.name || `จุดพิกัด #${qrOriginNode.id}`} • เลือกอาคารปลายทางได้เลย
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleChangeOriginMode("gps")}
            className="min-h-[34px] px-2.5 rounded-lg bg-white border border-teal-200 text-[11px] font-bold text-[#0F766E] hover:bg-teal-100/60 cursor-pointer"
          >
            ใช้ GPS
          </button>
          <button
            type="button"
            onClick={() => setQrBannerDismissed(true)}
            aria-label="ปิดแถบแจ้งจุดเริ่มต้น QR"
            className="w-7 h-7 rounded-lg hover:bg-teal-100 text-teal-700 flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    ) : null;

  // Building Search Content (Figma Frame 1)
  const searchContent = (
    <div className="space-y-4">
      {qrOriginNotice}

      {/* Live Autocomplete & Fuzzy Search Bar */}
      <BuildingSearchBar
        value={searchInput}
        allBuildings={allBuildings.length > 0 ? allBuildings : buildings}
        categories={categories}
        onChange={(nextVal) => {
          setSearchInput(nextVal);
          if (!nextVal.trim() && appliedQuery) {
            setAppliedQuery("");
            fetchBuildings("");
          }
        }}
        onSubmit={handleSearchSubmit}
        onClear={handleClearSearch}
        onSelectSuggestion={handleSelectSuggestion}
        onRouteSuggestion={handleSelectRoute}
      />

      {/* Horizontal Filter Chips (driven by GET /api/categories) */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {filterChips.map((chip) => {
          const isActive = activeFilter === chip.id;
          const totalCount =
            allBuildings.length > 0 ? allBuildings.length : buildings.length;
          const countSuffix =
            chip.id === "all" && totalCount > 0 ? ` (${totalCount})` : "";
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setActiveFilter(chip.id)}
              className={`min-h-[44px] px-4 rounded-full text-sm font-semibold whitespace-nowrap border transition-colors inline-flex items-center gap-2 cursor-pointer ${
                isActive
                  ? "bg-[#0F766E] border-[#0F766E] text-white shadow-sm"
                  : "bg-white border-slate-200 text-slate-700 hover:border-teal-300 hover:text-[#0F766E]"
              }`}
            >
              {chip.colorHex && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/15"
                  style={{
                    backgroundColor: isActive ? "#FFFFFF" : chip.colorHex,
                  }}
                />
              )}
              <span>
                {chip.label}
                {countSuffix}
              </span>
            </button>
          );
        })}
      </div>

      {/* Building List Header */}
      <div className="flex items-center justify-between pt-1">
        <h2 className="font-heading text-base font-bold text-[#0F172A]">
          รายชื่อตึกและแผนก
          {searchInput.trim() && (
            <span className="text-sm font-normal text-slate-500 ml-1.5">
              (&ldquo;{searchInput.trim()}&rdquo;)
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
          {(searchInput.trim() || appliedQuery || activeFilter !== "all") && (
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
              categories={categories}
              originCoords={displayOriginCoords}
              isSelected={targetBuilding?.id === building.id}
              searchQuery={searchInput}
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
    categories,
    originLabel: effectiveOriginLabel,
    originMode,
    originBuildingId,
    qrOriginNode,
    targetBuilding,
    routeData,
    isLoadingRoute,
    routeError,
    isNavigating,
    onChangeOriginMode: handleChangeOriginMode,
    onSwapOriginAndTarget: handleSwapOriginAndTarget,
    onPickTargetTab: () => setActiveTab("buildings"),
    onRetryRoute: () => {
      if (targetBuilding) {
        lastRerouteAtRef.current = Date.now();
        fetchRoute(rawOriginCoords, targetBuilding, {
          startNodeId: originMode === "building" ? originBuildingId : null,
        });
      }
    },
    onStartNavigation: handleStartNavigation,
    onEndNavigation: handleEndNavigation,
  };

  const sharedMapProps = {
    mapViewMode,
    onChangeMapViewMode: setMapViewMode,
    buildings: allBuildings.length > 0 ? allBuildings : buildings,
    categories,
    previewVersionId,
    displayOriginCoords,
    rawOriginCoords,
    userHeadingDeg,
    gpsStatus,
    gpsAccuracyMeters,
    followUser,
    headingUpMode,
    locateTrigger,
    isSnappedToPath: snapResult.isSnapped,
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
    onSelectBuilding: handleSelectRoute,
    onLocateMe: handleLocateMeClick,
    onChangeFollowUser: setFollowUser,
    onToggleHeadingUp: handleToggleHeadingUp,
    onToggleVoice: handleToggleVoice,
    onToggleSimulateWalk: handleToggleSimulateWalk,
    onEndNavigation: handleEndNavigation,
    onRecenterNavigation: handleRecenterNavigation,
    onToggleMockGps: handleToggleMockGps,
    onMockMapClick: handleMockMapClick,
    onToggleMockWalk: handleToggleMockWalk,
    onChangeMockProgress: handleChangeMockProgress,
    onResetMockWalk: handleResetMockWalk,
  };

  const activeMapElement =
    mapViewMode === "3d" ? (
      <Public3DMap {...sharedMapProps} />
    ) : (
      <PublicNavigationMap {...sharedMapProps} />
    );

  return (
    <div className="h-dvh w-full overflow-hidden flex flex-col md:flex-row bg-[#F8FAFC]">
      {/* ================= DESKTOP / TABLET LEFT SIDEBAR (420px) ================= */}
      <aside className="hidden md:flex md:w-[420px] md:shrink-0 h-full flex-col border-r border-slate-200 bg-[#F8FAFC]">
        {previewVersionId && (
          <div className="shrink-0 bg-amber-500 text-white px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-bold">
            <span className="truncate">
              โหมดตัวอย่างแผนที่ฉบับร่าง (เวอร์ชัน #{previewVersionId})
            </span>
            <a
              href="/"
              className="shrink-0 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px]"
            >
              กลับหน้าจริง
            </a>
          </div>
        )}
        <HospitalHeader gpsStatus={gpsStatus} onLocateMe={handleLocateMeClick} />
        <AnnouncementBanner announcements={announcements} />

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
            className={`min-h-[46px] rounded-full text-sm font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "route"
                ? "bg-[#0F766E] text-white shadow-[0_4px_12px_rgba(15,118,110,0.3)] -translate-y-0.5"
                : "bg-white border border-slate-200 text-slate-700 shadow-xs hover:border-teal-300 hover:text-[#0F766E]"
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
          {activeTab === "services" && (
            <ServiceDirectory
              servicePoints={servicePoints}
              buildings={allBuildings.length > 0 ? allBuildings : buildings}
              isLoading={isLoadingServices}
              error={servicesError}
              onRetry={fetchPublicMetadata}
              onNavigateToNode={handleNavigateToServiceNode}
            />
          )}
        </div>
      </aside>

      {/* ================= DESKTOP / TABLET RIGHT MAP AREA ================= */}
      <main className="hidden md:block flex-1 h-full relative">
        {isDesktopViewport ? activeMapElement : null}
      </main>

      {/* ================= MOBILE FULL-EXPERIENCE WEB APP (< 768px) ================= */}
      <div className="flex md:hidden flex-col h-dvh w-full overflow-hidden">
        {/* Hide header & announcements during Active Navigation on Mobile for full-screen Google Maps experience */}
        {!isNavigating && (
          <>
            {previewVersionId && (
              <div className="shrink-0 bg-amber-500 text-white px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-bold">
                <span className="truncate">
                  ตัวอย่างแผนที่ฉบับร่าง (#{previewVersionId})
                </span>
                <a
                  href="/"
                  className="shrink-0 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[11px]"
                >
                  หน้าจริง
                </a>
              </div>
            )}
            <HospitalHeader gpsStatus={gpsStatus} onLocateMe={handleLocateMeClick} />
            <AnnouncementBanner announcements={announcements} compact />
          </>
        )}

        {/* Mobile Main Stage */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          {!isNavigating && activeTab === "buildings" && (
            <div className="h-full overflow-y-auto p-4">{searchContent}</div>
          )}

          {!isNavigating && activeTab === "services" && (
            <div className="h-full overflow-y-auto p-4">
              <ServiceDirectory
                servicePoints={servicePoints}
                buildings={allBuildings.length > 0 ? allBuildings : buildings}
                isLoading={isLoadingServices}
                error={servicesError}
                onRetry={fetchPublicMetadata}
                onNavigateToNode={handleNavigateToServiceNode}
              />
            </div>
          )}

          {(isNavigating || activeTab === "route") && (
            <div className="h-full w-full relative flex flex-col">
              {/* Full-screen Map behind Bottom Sheet */}
              <div className="flex-1 relative min-h-0">
                {!isDesktopViewport ? activeMapElement : null}

                {/* Mobile Slide-Up Bottom Sheet (hidden during Active Navigation Mode) */}
                {!isNavigating && (
                  <div
                    className={`absolute inset-x-0 bottom-0 z-[500] bg-[#F8FAFC] rounded-t-3xl border-t border-slate-200 shadow-[0_-10px_30px_rgba(15,23,42,0.18)] transition-all duration-300 flex flex-col ${
                      sheetExpanded ? "max-h-[72%]" : "max-h-[126px]"
                    }`}
                  >
                    <div className="w-full pt-2.5 pb-2 px-4 flex flex-col items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSheetExpanded((prev) => !prev)}
                        className="w-full flex flex-col items-center gap-1 cursor-pointer"
                        aria-label={
                          sheetExpanded
                            ? "ย่อแผงรายละเอียดเส้นทาง"
                            : "ขยายแผงรายละเอียดเส้นทาง"
                        }
                      >
                        <span className="w-10 h-1.5 rounded-full bg-slate-300" />
                        <div className="w-full flex items-center justify-between pt-1 gap-2">
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

                      {/* 1-tap Start Navigation button visible even when Bottom Sheet is collapsed */}
                      {!sheetExpanded && routeData && (
                        <button
                          type="button"
                          onClick={handleStartNavigation}
                          className="w-full min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                        >
                          <Navigation className="w-4 h-4" />
                          <span>เริ่มนำทาง</span>
                        </button>
                      )}
                    </div>

                    {sheetExpanded && (
                      <div className="overflow-y-auto px-4 pb-4 flex-1">
                        {arrivalBannerInPanel}
                        <RoutePanel {...routePanelProps} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation Bar (hidden during Active Navigation for full-screen map) */}
        {!isNavigating && (
          <nav
            aria-label="แถบเมนูล่าง"
            className="relative z-[520] shrink-0 overflow-visible bg-white border-t border-slate-200 px-2.5 py-1.5 grid grid-cols-3 items-end gap-2 shadow-[0_-2px_10px_rgba(15,23,42,0.06)]"
          >
            <button
              type="button"
              onClick={() => setActiveTab("buildings")}
              className={`min-h-[50px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors cursor-pointer ${
                activeTab === "buildings"
                  ? "bg-[#CCFBF1] text-[#0F766E]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Search className="w-5 h-5" />
              <span>ค้นหาตึก</span>
            </button>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setActiveTab("route")}
                className={`relative -mt-3.5 w-full max-w-[116px] min-h-[58px] rounded-full px-3 py-1.5 flex flex-col items-center justify-center gap-0.5 text-xs font-bold border-2 transition-all cursor-pointer ${
                  activeTab === "route"
                    ? "bg-[#0F766E] text-white border-white shadow-[0_6px_16px_rgba(15,118,110,0.36)] ring-1 ring-teal-700/15"
                    : "bg-white text-slate-700 border-slate-100 shadow-[0_4px_12px_rgba(15,23,42,0.12)] hover:text-[#0F766E] hover:border-teal-100"
                }`}
              >
                <MapIcon className="w-5 h-5" />
                <span>เส้นทาง</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab("services")}
              className={`min-h-[50px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-colors cursor-pointer ${
                activeTab === "services"
                  ? "bg-[#CCFBF1] text-[#0F766E]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Headphones className="w-5 h-5" />
              <span>จุดบริการ</span>
            </button>
          </nav>
        )}
      </div>

      {/* Real-time Arrival Detection Modal (< 15m from destination) */}
      {showArrivalModal && targetBuilding && (
        <ArrivalModal
          building={routeData?.target_building ?? targetBuilding}
          categories={categories}
          distanceMeters={distanceToTargetMeters ?? 0}
          onClose={() => {
            dismissedArrivalKeyRef.current = `${targetBuilding.id}`;
            setShowArrivalModal(false);
          }}
          onSearchAnother={() => {
            dismissedArrivalKeyRef.current = `${targetBuilding.id}`;
            setShowArrivalModal(false);
            handleEndNavigation();
            setActiveTab("buildings");
          }}
        />
      )}
    </div>
  );
}
