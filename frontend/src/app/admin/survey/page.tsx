"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FastForward,
  Filter,
  FolderOpen,
  Gauge,
  Image as ImageIcon,
  Layers,
  Loader2,
  MapPin,
  Pause,
  Play,
  Plus,
  Route,
  Save,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Square,
  Stethoscope,
  Timer,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  extractApiError,
  type Category,
  type MapNode,
  type SurveyTrack,
} from "@/lib/api";
import { uploadCompressedImages } from "@/lib/imageUpload";
import {
  buildGpxXml,
  formatDurationClock,
  parseGpxOrGeoJson,
  simplifyTrackDouglasPeucker,
  type QuickWaypoint,
} from "@/lib/gpx";
import {
  calculateBearing,
  calculateDistanceMeters,
  computeCompassHeadingFromOrientation,
} from "@/lib/hospital";
import type { MapViewMode } from "@/lib/hospital3d";

const SurveyLiveMap = dynamic(
  () => import("@/components/maps/SurveyLiveMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#0F766E]" />
        <span className="text-sm font-medium">กำลังเปิดแผนที่ภาคสนาม...</span>
      </div>
    ),
  }
);

const SurveyLive3DMap = dynamic(
  () => import("@/components/maps/SurveyLive3DMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#E6EDF4] flex items-center justify-center text-slate-600 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#0F766E]" />
        <span className="text-sm font-medium">กำลังเปิดแผนที่ 3D ภาคสนาม...</span>
      </div>
    ),
  }
);

type RecordState = "idle" | "recording" | "paused";

const DRAFT_STORAGE_KEY = "hospital_nav_geo_tracker_draft_v1";

interface OfflineDraftState {
  trackPoints: [number, number][];
  quickWaypoints: QuickWaypoint[];
  elapsedSec: number;
  savedAt: string;
}

export default function AdminSurveyPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>("3d");

  // Live GPS Telemetry
  const [currentCoords, setCurrentCoords] = useState<[number, number] | null>(
    null
  );
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number>(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [followGps, setFollowGps] = useState<boolean>(true);
  const [focusCoords, setFocusCoords] = useState<[number, number] | null>(null);
  const [strictAccuracyFilter, setStrictAccuracyFilter] =
    useState<boolean>(true);

  // Geo Tracker Recording State (Idle -> Recording <-> Paused -> Save Modal)
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [trackPoints, setTrackPoints] = useState<[number, number][]>([]);
  const [quickWaypoints, setQuickWaypoints] = useState<QuickWaypoint[]>([]);

  // Save Track Modal + Status / Zone + Resume Existing Track
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [trackName, setTrackName] = useState("");
  const [trackZone, setTrackZone] = useState("");
  const [trackStatus, setTrackStatus] = useState<"in_progress" | "completed">(
    "in_progress"
  );
  const [resumingTrack, setResumingTrack] = useState<SurveyTrack | null>(null);
  const resumedBaseCountRef = useRef<number>(0);
  const [simplifyOnSave, setSimplifyOnSave] = useState(true);
  const [isSavingTrack, setIsSavingTrack] = useState(false);

  // Slide-up Sheet: Pin Building / Junction (multi-photo + floor/room tag builder)
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [pinIsBuilding, setPinIsBuilding] = useState(true);
  const [pinName, setPinName] = useState("");
  const [pinCategoryId, setPinCategoryId] = useState<number | null>(null);
  const [pinKeywords, setPinKeywords] = useState("");
  const [pinIndoorGuide, setPinIndoorGuide] = useState("");
  const [pinImageUrls, setPinImageUrls] = useState<string[]>([]);
  const [pinFloors, setPinFloors] = useState<
    { id: string; floor: string; rooms: string[]; draftRoom: string }[]
  >([{ id: "fl-1", floor: "ชั้น 1", rooms: [], draftRoom: "" }]);
  const [draftPinCoords, setDraftPinCoords] = useState<[number, number] | null>(
    null
  );
  const [photoUploadText, setPhotoUploadText] = useState<string | null>(null);
  const [isPinningNode, setIsPinningNode] = useState(false);

  // Slide-up Sheet: Saved Trips & Buildings + GPX Import/Export
  const [tripsSheetOpen, setTripsSheetOpen] = useState(false);
  const [tripsTab, setTripsTab] = useState<"tracks" | "buildings">("tracks");
  const [previewTrack, setPreviewTrack] = useState<SurveyTrack | null>(null);
  const [isImportingGpx, setIsImportingGpx] = useState(false);

  // Saved server lists
  const [categories, setCategories] = useState<Category[]>([]);
  const [pinnedNodes, setPinnedNodes] = useState<MapNode[]>([]);
  const [savedSurveys, setSavedSurveys] = useState<SurveyTrack[]>([]);
  const [statusToast, setStatusToast] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const recordStateRef = useRef<RecordState>("idle");
  const strictFilterRef = useRef<boolean>(true);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const gpxInputRef = useRef<HTMLInputElement | null>(null);
  const hasFreshCompassRef = useRef<number>(0);
  const prevGpsForHeadingRef = useRef<[number, number] | null>(null);

  const notify = useCallback((type: "success" | "error", text: string) => {
    setStatusToast({ type, text });
    setTimeout(() => {
      setStatusToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  const loadFieldData = useCallback(async () => {
    try {
      const [nodesRes, surveysRes, catsRes] = await Promise.all([
        api.get<MapNode[]>("/api/admin/nodes"),
        api.get<SurveyTrack[]>("/api/admin/surveys"),
        api.get<Category[]>("/api/admin/categories"),
      ]);
      setPinnedNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setSavedSurveys(Array.isArray(surveysRes.data) ? surveysRes.data : []);
      setCategories(Array.isArray(catsRes.data) ? catsRes.data : []);
    } catch {
      // Silent on init
    }
  }, []);

  // Load field data & restore offline draft (auth is guarded by AdminLayout via /api/admin/me)
  useEffect(() => {
    setAuthChecked(true);
    loadFieldData();

    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as OfflineDraftState;
        if (Array.isArray(draft.trackPoints) && draft.trackPoints.length > 0) {
          setTrackPoints(draft.trackPoints);
          setQuickWaypoints(
            Array.isArray(draft.quickWaypoints) ? draft.quickWaypoints : []
          );
          setElapsedSec(typeof draft.elapsedSec === "number" ? draft.elapsedSec : 0);
          setRecordState("paused");
          notify(
            "success",
            `กู้คืนรอยเดินที่บันทึกค้างไว้จากเครื่อง (${draft.trackPoints.length} พิกัด)`
          );
        }
      }
    } catch {
      // Ignore corrupt draft
    }
  }, [router, loadFieldData, notify]);

  // Persist offline draft automatically whenever track points change
  useEffect(() => {
    if (!authChecked) return;
    try {
      if (trackPoints.length > 0) {
        const draft: OfflineDraftState = {
          trackPoints,
          quickWaypoints,
          elapsedSec,
          savedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } else {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage quota issues
    }
  }, [authChecked, trackPoints, quickWaypoints, elapsedSec]);

  useEffect(() => {
    recordStateRef.current = recordState;
    window.dispatchEvent(
      new CustomEvent("admin-survey-recording-state", {
        detail: { recording: recordState === "recording" },
      })
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("admin-survey-recording-state", {
          detail: { recording: false },
        })
      );
    };
  }, [recordState]);

  useEffect(() => {
    strictFilterRef.current = strictAccuracyFilter;
  }, [strictAccuracyFilter]);

  // Stopwatch timer while recording
  useEffect(() => {
    if (recordState !== "recording") return;
    const interval = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [recordState]);

  // Continuous High-Accuracy GPS Watcher (with accuracy filtering)
  useEffect(() => {
    if (!authChecked) return;
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGpsError("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง GPS");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(7));
        const lng = Number(pos.coords.longitude.toFixed(7));
        const acc = Math.round(pos.coords.accuracy);
        const spdMs =
          typeof pos.coords.speed === "number" &&
          !Number.isNaN(pos.coords.speed) &&
          pos.coords.speed > 0
            ? pos.coords.speed
            : 0;

        setCurrentCoords([lat, lng]);
        setAccuracyMeters(acc);
        setSpeedKmh(Number((spdMs * 3.6).toFixed(1)));
        setGpsError(null);

        // Update directional arrow heading from GPS heading or walking vector when no live compass
        const hasFreshCompass = Date.now() - hasFreshCompassRef.current < 4000;
        if (!hasFreshCompass) {
          if (
            typeof pos.coords.heading === "number" &&
            !Number.isNaN(pos.coords.heading) &&
            pos.coords.heading >= 0 &&
            (spdMs >= 0.4 || pos.coords.speed === null)
          ) {
            setUserHeadingDeg(((pos.coords.heading % 360) + 360) % 360);
          } else if (prevGpsForHeadingRef.current) {
            const movedForBearing = calculateDistanceMeters(
              prevGpsForHeadingRef.current[0],
              prevGpsForHeadingRef.current[1],
              lat,
              lng
            );
            if (movedForBearing >= 1.5) {
              setUserHeadingDeg(
                calculateBearing(
                  prevGpsForHeadingRef.current[0],
                  prevGpsForHeadingRef.current[1],
                  lat,
                  lng
                )
              );
              prevGpsForHeadingRef.current = [lat, lng];
            }
          } else {
            prevGpsForHeadingRef.current = [lat, lng];
          }
        }

        if (recordStateRef.current === "recording") {
          // Drop noisy GPS spikes when strict accuracy filter is active (> 22m)
          if (strictFilterRef.current && acc > 22) {
            return;
          }

          setTrackPoints((prev) => {
            if (prev.length === 0) return [[lat, lng]];
            const last = prev[prev.length - 1];
            const movedMeters = calculateDistanceMeters(
              last[0],
              last[1],
              lat,
              lng
            );
            // Ignore standing-still jitter (< 2m)
            if (movedMeters < 2) return prev;
            return [...prev, [lat, lng]];
          });
        }
      },
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "กรุณาอนุญาตการเข้าถึงตำแหน่ง GPS ของเบราว์เซอร์"
            : "สัญญาณ GPS อ่อน (สามารถแตะแผนที่เพื่อปักจุดเองได้)"
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [authChecked]);

  // Real-time True-North Compass for directional location arrow (Android & iOS)
  useEffect(() => {
    if (!authChecked || typeof window === "undefined") return;
    const onOrient = (ev: DeviceOrientationEvent) => {
      const heading = computeCompassHeadingFromOrientation(ev);
      if (heading !== null) {
        hasFreshCompassRef.current = Date.now();
        setUserHeadingDeg((prev) => {
          const diff = ((heading - prev + 540) % 360) - 180;
          if (Math.abs(diff) < 1.2) return prev;
          return ((prev + diff * 0.35) % 360 + 360) % 360;
        });
      }
    };
    window.addEventListener(
      "deviceorientationabsolute",
      onOrient as EventListener,
      true
    );
    window.addEventListener("deviceorientation", onOrient, true);
    return () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        onOrient as EventListener,
        true
      );
      window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, [authChecked]);

  // Screen Wake Lock while actively recording
  const requestWakeLock = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        await wakeLockRef.current.release();
      }
    } catch {
      // Ignore
    } finally {
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    if (recordState !== "recording") {
      releaseWakeLock();
      return;
    }
    requestWakeLock();
    const onVis = () => {
      if (
        document.visibilityState === "visible" &&
        recordStateRef.current === "recording"
      ) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      releaseWakeLock();
    };
  }, [recordState, requestWakeLock, releaseWakeLock]);

  const totalTrackDistanceM = useMemo(() => {
    if (trackPoints.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < trackPoints.length; i++) {
      sum += calculateDistanceMeters(
        trackPoints[i - 1][0],
        trackPoints[i - 1][1],
        trackPoints[i][0],
        trackPoints[i][1]
      );
    }
    return Math.round(sum);
  }, [trackPoints]);

  const avgSpeedKmh = useMemo(() => {
    if (elapsedSec > 0 && totalTrackDistanceM > 0) {
      return Number(((totalTrackDistanceM / elapsedSec) * 3.6).toFixed(1));
    }
    return speedKmh;
  }, [elapsedSec, totalTrackDistanceM, speedKmh]);

  const simplifiedPreviewPoints = useMemo(() => {
    if (trackPoints.length <= 2) return trackPoints;
    return simplifyTrackDouglasPeucker(trackPoints, 1.8);
  }, [trackPoints]);

  const activePinCoords = draftPinCoords || currentCoords;

  // Geo Tracker Main Record / Pause / Resume Handler
  const handlePrimaryRecordToggle = () => {
    if (recordState === "idle") {
      setPreviewTrack(null);
      setElapsedSec(0);
      setQuickWaypoints([]);
      if (currentCoords) {
        setTrackPoints([currentCoords]);
      } else {
        setTrackPoints([]);
      }
      setFollowGps(true);
      setRecordState("recording");
      notify("success", "เริ่มอัดรอยเดินแล้ว (เปิดกันจอดับอัตโนมัติ)");
    } else if (recordState === "recording") {
      setRecordState("paused");
      notify("success", "พักการอัดชั่วคราวแล้ว กดอัดต่อหรือหยุดเพื่อบันทึกได้");
    } else {
      setFollowGps(true);
      setRecordState("recording");
      notify("success", "กำลังอัดรอยเดินต่อ...");
    }
  };

  const handleStopAndReview = () => {
    setRecordState("paused");
    if (trackPoints.length < 2) {
      notify("error", "ต้องมีอย่างน้อย 2 พิกัดก่อนบันทึก (กดปุ่ม + เพิ่มจุดลงรอยเดินได้)");
      return;
    }
    if (!trackName.trim()) {
      const now = new Date();
      setTrackName(
        `สำรวจทางเดิน ${now.toLocaleDateString("th-TH", {
          day: "2-digit",
          month: "short",
        })} ${now.toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      );
    }
    setSaveModalOpen(true);
  };

  const handleDropManualPoint = () => {
    const pt = activePinCoords;
    if (!pt) {
      notify("error", "ยังไม่มีพิกัด GPS กรุณารอสัญญาณหรือแตะบนแผนที่");
      return;
    }
    setTrackPoints((prev) => [...prev, pt]);
    setQuickWaypoints((prev) => [
      ...prev,
      {
        id: `wpt-${Date.now()}`,
        label: `จุดปัก #${prev.length + 1}`,
        lat: pt[0],
        lng: pt[1],
        createdAt: new Date().toISOString(),
      },
    ]);
    if (recordState === "idle") {
      setRecordState("paused");
    }
    notify("success", "ปักจุดลงในรอยเดินเรียบร้อยแล้ว");
  };

  const handleUndoLastPoint = () => {
    if (trackPoints.length === 0) return;
    setTrackPoints((prev) => prev.slice(0, -1));
    notify("success", "ลบพิกัดล่าสุดออกแล้ว");
  };

  const handleStartResumeTrack = (track: SurveyTrack) => {
    const existingPts = Array.isArray(track.points_json)
      ? track.points_json.filter(
          (p) =>
            Array.isArray(p) &&
            p.length >= 2 &&
            typeof p[0] === "number" &&
            typeof p[1] === "number"
        )
      : [];
    setResumingTrack(track);
    resumedBaseCountRef.current = existingPts.length;
    setTrackPoints(existingPts);
    setQuickWaypoints([]);
    setTrackName(track.name);
    setTrackZone(track.zone || "");
    setTrackStatus(
      track.status === "completed" ? "completed" : "in_progress"
    );
    setPreviewTrack(null);
    setElapsedSec(0);
    setRecordState("paused");
    setTripsSheetOpen(false);
    if (existingPts.length > 0) {
      setFocusCoords(existingPts[existingPts.length - 1]);
    }
    notify(
      "success",
      `โหลด "${track.name}" (${existingPts.length} จุด) แล้ว กด "อัดต่อ" เพื่อเดินเก็บพิกัดต่อท้ายได้เลย`
    );
  };

  const handleToggleTrackStatus = async (track: SurveyTrack) => {
    const nextStatus =
      track.status === "completed" ? "in_progress" : "completed";
    try {
      const res = await api.put<SurveyTrack>(
        `/api/admin/survey-tracks/${track.id}`,
        { status: nextStatus }
      );
      setSavedSurveys((prev) =>
        prev.map((s) => (s.id === res.data.id ? res.data : s))
      );
      notify(
        "success",
        nextStatus === "completed"
          ? `เปลี่ยนสถานะ "${track.name}" เป็นเสร็จแล้ว`
          : `เปลี่ยนสถานะ "${track.name}" เป็นกำลังทำ`
      );
    } catch (err) {
      notify("error", extractApiError(err, "ไม่สามารถเปลี่ยนสถานะรอยเดินได้"));
    }
  };

  const handleDiscardCurrentTrack = () => {
    setRecordState("idle");
    setTrackPoints([]);
    setQuickWaypoints([]);
    setElapsedSec(0);
    setTrackName("");
    setTrackZone("");
    setTrackStatus("in_progress");
    setResumingTrack(null);
    resumedBaseCountRef.current = 0;
    setSaveModalOpen(false);
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Ignore
    }
    notify("success", "ล้างรอยเดินปัจจุบันเรียบร้อยแล้ว");
  };

  const handleDownloadGpx = (
    name: string,
    pts: [number, number][],
    wpts: QuickWaypoint[] = []
  ) => {
    if (pts.length < 2) {
      notify("error", "ต้องมีอย่างน้อย 2 พิกัดก่อนดาวน์โหลดไฟล์ GPX");
      return;
    }
    const xml = buildGpxXml(name, pts, wpts);
    const blob = new Blob([xml], { type: "application/gpx+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "survey-track").replace(/[^a-zA-Z0-9ก-๙_-]/g, "_")}.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify("success", "ดาวน์โหลดไฟล์ .GPX เรียบร้อยแล้ว");
  };

  const handleSaveSurveyTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameToSave =
      trackName.trim() ||
      `รอยเดินสำรวจ ${new Date().toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;

    setIsSavingTrack(true);
    try {
      if (resumingTrack) {
        const baseCount = resumedBaseCountRef.current;
        const rawAppended = trackPoints.slice(baseCount);
        const appendedPoints =
          simplifyOnSave && rawAppended.length > 2
            ? simplifyTrackDouglasPeucker(rawAppended, 1.8)
            : rawAppended;

        const res = await api.put<SurveyTrack>(
          `/api/admin/survey-tracks/${resumingTrack.id}/append`,
          {
            points_json: appendedPoints,
            name: nameToSave,
            zone: trackZone.trim(),
            status: trackStatus,
          }
        );
        setSavedSurveys((prev) =>
          prev.map((s) => (s.id === res.data.id ? res.data : s))
        );
        setPreviewTrack(res.data);
        notify(
          "success",
          `อัดต่อและอัปเดต "${res.data.name}" เรียบร้อยแล้ว (+${appendedPoints.length} พิกัดใหม่)`
        );
      } else {
        const finalPoints = simplifyOnSave
          ? simplifiedPreviewPoints
          : trackPoints;
        if (finalPoints.length < 2) {
          notify("error", "ต้องมีอย่างน้อย 2 พิกัดก่อนบันทึกรอยเดิน");
          setIsSavingTrack(false);
          return;
        }
        const res = await api.post<SurveyTrack>("/api/admin/survey-tracks", {
          name: nameToSave,
          zone: trackZone.trim(),
          status: trackStatus,
          points_json: finalPoints,
        });
        setSavedSurveys((prev) => [res.data, ...prev]);
        setPreviewTrack(res.data);
        notify(
          "success",
          `บันทึกรอยเดิน "${res.data.name}" (${finalPoints.length} พิกัด) เข้าระบบแล้ว`
        );
      }

      setTrackPoints([]);
      setQuickWaypoints([]);
      setElapsedSec(0);
      setTrackName("");
      setTrackZone("");
      setTrackStatus("in_progress");
      setResumingTrack(null);
      resumedBaseCountRef.current = 0;
      setRecordState("idle");
      setSaveModalOpen(false);
      try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Ignore
      }
    } catch (err) {
      notify("error", extractApiError(err, "ไม่สามารถบันทึกรอยเดินได้"));
    } finally {
      setIsSavingTrack(false);
    }
  };

  const handleImportGpxFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingGpx(true);
    try {
      const text = await file.text();
      const { name, points } = parseGpxOrGeoJson(text, file.name);
      if (points.length < 2) {
        notify("error", "ไม่พบเส้นทางในไฟล์ (ต้องมีอย่างน้อย 2 พิกัด)");
        return;
      }
      const cleaned = simplifyTrackDouglasPeucker(points, 1.5);
      const res = await api.post<SurveyTrack>("/api/admin/surveys", {
        name,
        points_json: cleaned,
      });
      setSavedSurveys((prev) => [res.data, ...prev]);
      setPreviewTrack(res.data);
      setTripsSheetOpen(false);
      notify(
        "success",
        `นำเข้า "${res.data.name}" สำเร็จ (${cleaned.length} พิกัด) แสดงบนแผนที่แล้ว`
      );
    } catch (err) {
      notify(
        "error",
        err instanceof Error ? err.message : "นำเข้าไฟล์ GPX/GeoJSON ไม่สำเร็จ"
      );
    } finally {
      setIsImportingGpx(false);
      e.target.value = "";
    }
  };

  const handleUploadBuildingPhotos = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPhotoUploadText(`กำลังย่อรูปและอัปโหลด 0/${files.length}...`);
    try {
      const uploaded = await uploadCompressedImages(files, (done, total) => {
        setPhotoUploadText(`กำลังย่อรูปและอัปโหลด ${done}/${total}...`);
      });
      if (uploaded.length > 0) {
        setPinImageUrls((prev) => Array.from(new Set([...prev, ...uploaded])));
        notify(
          "success",
          `อัปโหลดภาพถ่าย ${uploaded.length} รูปเรียบร้อยแล้ว`
        );
      }
    } catch (err) {
      notify("error", extractApiError(err, "อัปโหลดรูปภาพไม่สำเร็จ"));
    } finally {
      setPhotoUploadText(null);
      e.target.value = "";
    }
  };

  const handleAddSurveyFloor = () => {
    setPinFloors((prev) => {
      const nextNum = prev.length + 1;
      return [
        ...prev,
        {
          id: `fl-${Date.now()}-${nextNum}`,
          floor: `ชั้น ${nextNum}`,
          rooms: [],
          draftRoom: "",
        },
      ];
    });
  };

  const handleAddRoomTagToFloor = (floorId: string) => {
    setPinFloors((prev) =>
      prev.map((f) => {
        if (f.id !== floorId) return f;
        const incoming = f.draftRoom
          .split(/[,，\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (incoming.length === 0) return f;
        const merged = Array.from(new Set([...f.rooms, ...incoming]));
        return { ...f, rooms: merged, draftRoom: "" };
      })
    );
  };

  const handleSaveBuildingOrPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePinCoords) {
      notify(
        "error",
        "ยังไม่มีพิกัดที่จะบันทึก กรุณารอสัญญาณ GPS หรือแตะบนแผนที่"
      );
      return;
    }
    const trimmedName = pinName.trim();
    if (!trimmedName) {
      notify("error", "กรุณากรอกชื่อตึกหรือจุดทางแยกก่อนบันทึก");
      return;
    }

    // Include any typed-but-not-yet-submitted draft room text automatically
    const normalizedFloors = pinFloors.map((f) => {
      const extra = f.draftRoom
        .split(/[,，\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const rooms = Array.from(new Set([...f.rooms, ...extra]));
      const floorLabel = f.floor.trim()
        ? f.floor.trim().startsWith("ชั้น")
          ? f.floor.trim()
          : `ชั้น ${f.floor.trim()}`
        : "ชั้น 1";
      return { floor: floorLabel, rooms };
    });

    const activeFloors = normalizedFloors.filter((f) => f.rooms.length > 0);
    const shortFloorNames = normalizedFloors
      .map((f) => f.floor.replace(/^ชั้น\s*/i, "").trim())
      .filter(Boolean);
    const computedFloorRange =
      shortFloorNames.length > 1
        ? `${shortFloorNames[0]} - ${shortFloorNames[shortFloorNames.length - 1]}`
        : shortFloorNames[0] || "";

    setIsPinningNode(true);
    try {
      const res = await api.post<MapNode>("/api/admin/nodes", {
        name: trimmedName,
        is_building: pinIsBuilding,
        category_id: pinIsBuilding ? pinCategoryId : null,
        floor_range: pinIsBuilding ? computedFloorRange : "",
        keywords: pinIsBuilding ? pinKeywords.trim() : "",
        indoor_guide: pinIsBuilding ? pinIndoorGuide.trim() : "",
        image_url: pinIsBuilding ? pinImageUrls[0] || "" : "",
        image_urls: pinIsBuilding ? pinImageUrls : [],
        lat: activePinCoords[0],
        lng: activePinCoords[1],
      });

      let savedRoomsCount = 0;
      if (pinIsBuilding && res.data?.id && activeFloors.length > 0) {
        for (const fl of activeFloors) {
          for (const roomName of fl.rooms) {
            await api.post("/api/admin/departments", {
              node_id: res.data.id,
              name: roomName,
              floor: fl.floor,
              operating_hours: "",
              phone: "",
              keywords: "",
            });
            savedRoomsCount++;
          }
        }
      }

      setPinnedNodes((prev) => [res.data, ...prev]);
      setPinName("");
      setPinCategoryId(null);
      setPinKeywords("");
      setPinIndoorGuide("");
      setPinImageUrls([]);
      setPinFloors([{ id: "fl-1", floor: "ชั้น 1", rooms: [], draftRoom: "" }]);
      setDraftPinCoords(null);
      setPinSheetOpen(false);
      notify(
        "success",
        pinIsBuilding
          ? `บันทึกอาคาร "${res.data.name}" (${pinImageUrls.length} รูป, ${savedRoomsCount} ห้อง/แผนก) แล้ว`
          : `บันทึกจุดทางแยก "${res.data.name}" แล้ว`
      );
    } catch (err) {
      notify("error", extractApiError(err, "ไม่สามารถบันทึกจุดได้"));
    } finally {
      setIsPinningNode(false);
    }
  };

  const handleDeletePinnedNode = async (node: MapNode) => {
    try {
      await api.delete(`/api/admin/nodes/${node.id}`);
      setPinnedNodes((prev) => prev.filter((n) => n.id !== node.id));
      notify("success", `ลบ "${node.name || `จุด #${node.id}`}" แล้ว`);
    } catch (err) {
      notify("error", extractApiError(err, "ลบจุดไม่สำเร็จ"));
    }
  };

  const handleDeleteSavedTrack = async (id: number) => {
    try {
      await api.delete(`/api/admin/surveys/${id}`);
      setSavedSurveys((prev) => prev.filter((s) => s.id !== id));
      if (previewTrack?.id === id) setPreviewTrack(null);
      notify("success", "ลบรอยเดินสำรวจแล้ว");
    } catch (err) {
      notify("error", extractApiError(err, "ลบรอยเดินไม่สำเร็จ"));
    }
  };

  if (!authChecked) {
    return (
      <div className="flex-1 min-h-0 h-full bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
      </div>
    );
  }

  const accuracyBadge =
    accuracyMeters === null
      ? { label: "รอ GPS", cls: "bg-slate-100 text-slate-600" }
      : accuracyMeters <= 10
      ? { label: `GPS ±${accuracyMeters} ม.`, cls: "bg-[#CCFBF1] text-[#047857]" }
      : accuracyMeters <= 22
      ? { label: `GPS ±${accuracyMeters} ม.`, cls: "bg-amber-100 text-amber-800" }
      : { label: `GPS อ่อน ±${accuracyMeters} ม.`, cls: "bg-[#FFE4E6] text-[#BE123C]" };

  const buildingList = pinnedNodes.filter((n) => n.is_building);

  return (
    <div className="flex-1 min-h-0 h-full w-full relative overflow-hidden bg-slate-900">
      {/* Hidden GPX / GeoJSON File Input */}
      <input
        ref={gpxInputRef}
        type="file"
        accept=".gpx,.geojson,.json,application/gpx+xml"
        onChange={handleImportGpxFile}
        className="hidden"
      />

      {/* Full-Viewport Live 3D / Satellite / Street Map */}
      <div className="absolute inset-0">
        {mapViewMode === "3d" ? (
          <SurveyLive3DMap
            mapViewMode={mapViewMode}
            onChangeMapViewMode={setMapViewMode}
            currentCoords={currentCoords}
            userHeadingDeg={userHeadingDeg}
            accuracyMeters={accuracyMeters}
            trackPoints={trackPoints}
            quickWaypoints={quickWaypoints}
            previewTrack={previewTrack}
            pinnedNodes={pinnedNodes}
            draftPinCoords={draftPinCoords}
            focusCoords={focusCoords}
            followGps={followGps}
            onChangeFollowGps={setFollowGps}
            onMapTapToAdjustPin={(lat, lng) => {
              setDraftPinCoords([lat, lng]);
              setFollowGps(false);
            }}
          />
        ) : (
          <SurveyLiveMap
            mapViewMode={mapViewMode}
            onChangeMapViewMode={setMapViewMode}
            currentCoords={currentCoords}
            userHeadingDeg={userHeadingDeg}
            accuracyMeters={accuracyMeters}
            trackPoints={trackPoints}
            quickWaypoints={quickWaypoints}
            previewTrack={previewTrack}
            pinnedNodes={pinnedNodes}
            draftPinCoords={draftPinCoords}
            focusCoords={focusCoords}
            followGps={followGps}
            onChangeFollowGps={setFollowGps}
            onMapTapToAdjustPin={(lat, lng) => {
              setDraftPinCoords([lat, lng]);
              setFollowGps(false);
            }}
          />
        )}
      </div>

      {/* ================= TOP FLOATING GEO TRACKER TELEMETRY HUD ================= */}
      <div className="absolute top-3 left-3 right-3 z-[430] pointer-events-none flex flex-col items-center gap-1.5">
        <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-lg px-3.5 py-2.5 space-y-2">
          {/* Status Row: Recording Indicator + GPS Accuracy + Filter + WakeLock */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  recordState === "recording"
                    ? "bg-[#BE123C] text-white animate-pulse"
                    : recordState === "paused"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    recordState === "recording"
                      ? "bg-white"
                      : recordState === "paused"
                      ? "bg-amber-500"
                      : "bg-slate-400"
                  }`}
                />
                <span>
                  {recordState === "recording"
                    ? "กำลังอัดรอยเดิน"
                    : recordState === "paused"
                    ? "พักชั่วคราว"
                    : "พร้อมบันทึก"}
                </span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold ${accuracyBadge.cls}`}
              >
                {accuracyBadge.label}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStrictAccuracyFilter((prev) => !prev)}
                title="กรองพิกัด GPS ที่คลาดเคลื่อนเกิน 22 เมตรออกอัตโนมัติ"
                className={`h-7 px-2 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border cursor-pointer transition-colors ${
                  strictAccuracyFilter
                    ? "bg-teal-50 border-teal-200 text-[#0F766E]"
                    : "bg-slate-50 border-slate-200 text-slate-500"
                }`}
              >
                <Filter className="w-3 h-3" />
                <span>กรองแกว่ง</span>
              </button>
              <span
                className={`h-7 px-2 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 ${
                  wakeLockActive
                    ? "bg-[#CCFBF1] text-[#047857]"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                <Smartphone className="w-3 h-3" />
                <span className="hidden sm:inline">
                  {wakeLockActive ? "กันจอดับ" : "ปกติ"}
                </span>
              </span>
            </div>
          </div>

          {/* 3-Column Live Metrics (Distance / Time / Speed) */}
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500">
                <Route className="w-3 h-3 text-[#0F766E]" />
                <span>ระยะทาง ({trackPoints.length} จุด)</span>
              </div>
              <div className="font-heading text-base sm:text-lg font-bold text-[#0F172A] tabular-nums leading-tight mt-0.5">
                {totalTrackDistanceM >= 1000
                  ? `${(totalTrackDistanceM / 1000).toFixed(2)} กม.`
                  : `${totalTrackDistanceM} ม.`}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500">
                <Timer className="w-3 h-3 text-[#0F766E]" />
                <span>เวลาเดิน</span>
              </div>
              <div className="font-heading text-base sm:text-lg font-bold text-[#0F766E] tabular-nums leading-tight mt-0.5">
                {formatDurationClock(elapsedSec)}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500">
                <Gauge className="w-3 h-3 text-[#0F766E]" />
                <span>ความเร็ว</span>
              </div>
              <div className="font-heading text-base sm:text-lg font-bold text-[#0F172A] tabular-nums leading-tight mt-0.5">
                {avgSpeedKmh} กม./ชม.
              </div>
            </div>
          </div>
        </div>

        {/* GPS Error or Active Preview Track Pill */}
        {gpsError && (
          <div className="pointer-events-auto max-w-xl w-full rounded-xl bg-[#FFE4E6]/95 border border-rose-200 px-3 py-1.5 flex items-center gap-2 text-xs font-semibold text-[#BE123C] shadow-sm">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{gpsError}</span>
          </div>
        )}

        {resumingTrack && (
          <div className="pointer-events-auto rounded-full bg-amber-500 text-white px-3.5 py-1.5 shadow-md text-xs font-bold flex items-center gap-2">
            <FastForward className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[240px]">
              อัดต่อจาก: {resumingTrack.name} (+
              {Math.max(0, trackPoints.length - resumedBaseCountRef.current)} จุดใหม่)
            </span>
            <button
              type="button"
              onClick={handleDiscardCurrentTrack}
              title="ยกเลิกการอัดต่อ"
              className="w-5 h-5 rounded-full bg-black/15 hover:bg-black/25 flex items-center justify-center cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {previewTrack && (
          <div className="pointer-events-auto rounded-full bg-sky-600 text-white px-3.5 py-1.5 shadow-md text-xs font-bold flex items-center gap-2">
            <Route className="w-3.5 h-3.5" />
            <span>กำลังดูรอยเดิน: {previewTrack.name}</span>
            <button
              type="button"
              onClick={() => setPreviewTrack(null)}
              className="w-5 h-5 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center cursor-pointer"
              aria-label="ปิดการดูรอยเดิน"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* ================= BOTTOM FLOATING GEO TRACKER ACTION DOCK ================= */}
      <div className="absolute bottom-4 left-3 right-3 z-[430] pointer-events-none flex flex-col items-center gap-2">
        {/* Manual Pin Notice when user tapped map */}
        {draftPinCoords && (
          <div className="pointer-events-auto rounded-full bg-amber-500 text-white px-3.5 py-1.5 shadow-md text-xs font-bold flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5" />
            <span>
              เลือกพิกัดเอง ({draftPinCoords[0].toFixed(5)},{" "}
              {draftPinCoords[1].toFixed(5)})
            </span>
            <button
              type="button"
              onClick={() => setPinSheetOpen(true)}
              className="px-2 py-0.5 rounded-full bg-white text-amber-800 text-[11px] font-bold cursor-pointer"
            >
              ปักชื่อตึกที่นี่
            </button>
            <button
              type="button"
              onClick={() => setDraftPinCoords(null)}
              className="w-5 h-5 rounded-full bg-black/15 hover:bg-black/25 flex items-center justify-center cursor-pointer"
              aria-label="ล้างพิกัดที่แตะเลือก"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="pointer-events-auto w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl px-3 py-2.5 flex items-center justify-between gap-2">
          {/* Left Tools: Pin Building + Manual Point / Undo */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPinSheetOpen(true)}
              title="ปักจุดและใส่ชื่อตึก/ทางแยก"
              className="h-12 px-3 rounded-2xl bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-[#0F766E] flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold cursor-pointer transition-colors"
            >
              <Building2 className="w-4 h-4" />
              <span>ปักตึก</span>
            </button>

            <button
              type="button"
              onClick={handleDropManualPoint}
              disabled={!activePinCoords}
              title="เพิ่มจุดพิกัดปัจจุบันลงรอยเดินทันที"
              className="h-12 px-3 rounded-2xl bg-slate-100 hover:bg-orange-50 disabled:opacity-40 text-slate-700 hover:text-orange-600 flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>ลงจุด</span>
            </button>

            {trackPoints.length > 0 && (
              <button
                type="button"
                onClick={handleUndoLastPoint}
                title="ย้อนกลับลบพิกัดล่าสุด"
                className="w-10 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Center Iconic Geo Tracker Record / Pause + Stop Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrimaryRecordToggle}
              aria-label={
                recordState === "recording"
                  ? "พักการอัดรอยเดิน"
                  : recordState === "paused"
                  ? "อัดรอยเดินต่อ"
                  : "เริ่มอัดรอยเดิน"
              }
              className={`h-14 px-5 rounded-full font-bold text-sm text-white shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95 cursor-pointer ${
                recordState === "recording"
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-[#BE123C] hover:bg-rose-800"
              }`}
            >
              {recordState === "recording" ? (
                <>
                  <Pause className="w-5 h-5 fill-current" />
                  <span>พัก</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>{recordState === "paused" ? "อัดต่อ" : "เริ่มอัด"}</span>
                </>
              )}
            </button>

            {recordState !== "idle" && (
              <button
                type="button"
                onClick={handleStopAndReview}
                title="หยุดและบันทึกรอยเดิน"
                aria-label="หยุดและบันทึกรอยเดิน"
                className="w-12 h-12 rounded-full bg-[#0F766E] hover:bg-[#115E59] text-white shadow-md flex items-center justify-center cursor-pointer transition-transform active:scale-95"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}
          </div>

          {/* Right Tool: Saved Trips & GPX Drawer */}
          <button
            type="button"
            onClick={() => setTripsSheetOpen(true)}
            title="รายการรอยเดินที่บันทึกไว้ และนำเข้า/ส่งออก GPX"
            className="h-12 px-3 rounded-2xl bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-[#0F766E] flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold cursor-pointer transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            <span>รอยเดิน ({savedSurveys.length})</span>
          </button>
        </div>
      </div>

      {/* ================= TOAST NOTIFICATION ================= */}
      {statusToast && (
        <div
          className={`fixed top-36 left-1/2 -translate-x-1/2 z-[1200] max-w-sm w-[calc(100%-24px)] rounded-2xl px-4 py-2.5 shadow-xl border flex items-center gap-2 text-xs font-bold ${
            statusToast.type === "success"
              ? "bg-[#0F766E] text-white border-teal-700"
              : "bg-[#FFE4E6] text-[#BE123C] border-rose-200"
          }`}
        >
          {statusToast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 shrink-0" />
          )}
          <span>{statusToast.text}</span>
        </div>
      )}

      {/* ================= MODAL: STOP & SAVE TRACK (WITH SIMPLIFY + GPX EXPORT) ================= */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-3">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {resumingTrack
                  ? `บันทึกการอัดต่อ: ${resumingTrack.name}`
                  : "บันทึกรอยเดินสำรวจ"}
              </h2>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSurveyTrack} className="p-5 space-y-3.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                  <p className="text-[11px] text-slate-500">ระยะทาง</p>
                  <p className="font-heading text-sm font-bold text-[#0F172A]">
                    {totalTrackDistanceM} ม.
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                  <p className="text-[11px] text-slate-500">เวลาเดิน</p>
                  <p className="font-heading text-sm font-bold text-[#0F766E]">
                    {formatDurationClock(elapsedSec)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                  <p className="text-[11px] text-slate-500">จำนวนพิกัด</p>
                  <p className="font-heading text-sm font-bold text-[#0F172A]">
                    {simplifyOnSave
                      ? simplifiedPreviewPoints.length
                      : trackPoints.length}{" "}
                    จุด
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อเส้นทางสำรวจ *
                </label>
                <input
                  type="text"
                  required
                  value={trackName}
                  onChange={(e) => setTrackName(e.target.value)}
                  placeholder="เช่น หน้าตึก ER ถึง ตึก 10 ชั้น ร่มเย็น"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              {/* Zone Input + Quick Zone Chips */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  โซนพื้นที่ (Zone)
                </label>
                <input
                  type="text"
                  value={trackZone}
                  onChange={(e) => setTrackZone(e.target.value)}
                  placeholder="เช่น โซนหน้า ER, โซนตึกร่มเย็น, โซนฝั่งใต้"
                  className="w-full min-h-[40px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "โซนหน้า ER",
                    "โซนตึกร่มเย็น",
                    "โซนตึกร่มธรรม",
                    "โซนฝั่งใต้",
                    "โซนอาคารวิเคราะห์",
                  ].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setTrackZone(z)}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                        trackZone === z
                          ? "bg-[#0F766E] border-[#0F766E] text-white"
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-teal-50"
                      }`}
                    >
                      {z}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Toggle: In Progress vs Completed */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  สถานะรอยเดิน
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTrackStatus("in_progress")}
                    className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      trackStatus === "in_progress"
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-amber-50"
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>กำลังทำ (In Progress)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrackStatus("completed")}
                    className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      trackStatus === "completed"
                        ? "bg-[#047857] border-[#047857] text-white"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-emerald-50"
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>เสร็จแล้ว (Completed)</span>
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-teal-50/70 border border-teal-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simplifyOnSave}
                  onChange={(e) => setSimplifyOnSave(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-[#0F766E]"
                />
                <div className="text-xs">
                  <span className="font-bold text-[#0F172A] flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-[#0F766E]" />
                    <span>ปรับเส้นให้เรียบอัตโนมัติ (ลดจุดซ้ำ/แกว่ง)</span>
                  </span>
                  <span className="text-slate-600 block mt-0.5">
                    ลดจาก {trackPoints.length} เหลือ{" "}
                    {simplifiedPreviewPoints.length} พิกัด โดยคงแนวทางเดินเดิมแม่นยำ
                  </span>
                </div>
              </label>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSavingTrack}
                  className="w-full min-h-[46px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSavingTrack ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>บันทึกขึ้นระบบแผนที่</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadGpx(
                        trackName,
                        simplifyOnSave ? simplifiedPreviewPoints : trackPoints,
                        quickWaypoints
                      )
                    }
                    className="min-h-[42px] px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-[#0F766E]" />
                    <span>ดาวน์โหลด .GPX</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDiscardCurrentTrack}
                    className="min-h-[42px] px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-[#BE123C] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>ลบรอยเดินนี้</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= SLIDE-UP SHEET: PIN BUILDING / JUNCTION ================= */}
      {pinSheetOpen && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[88dvh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#0F766E]" />
                <h2 className="font-heading text-base font-bold text-[#0F172A]">
                  ปักตึก / จุดทางแยกภาคสนาม
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPinSheetOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveBuildingOrPoint}
              className="p-5 space-y-3.5 overflow-y-auto flex-1"
            >
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 flex items-center justify-between gap-2">
                <span>
                  พิกัด:{" "}
                  <strong className="font-mono text-[#0F172A]">
                    {activePinCoords
                      ? `${activePinCoords[0].toFixed(5)}, ${activePinCoords[1].toFixed(5)}`
                      : "รอสัญญาณ GPS..."}
                  </strong>
                </span>
                {draftPinCoords && (
                  <button
                    type="button"
                    onClick={() => setDraftPinCoords(null)}
                    className="text-[#0F766E] font-bold hover:underline cursor-pointer"
                  >
                    ใช้พิกัด GPS
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPinIsBuilding(true)}
                  className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    pinIsBuilding
                      ? "bg-[#0F766E] border-[#0F766E] text-white"
                      : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>เพิ่มตึก / อาคาร</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPinIsBuilding(false)}
                  className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                    !pinIsBuilding
                      ? "bg-[#1D4ED8] border-[#1D4ED8] text-white"
                      : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  <span>เพิ่มจุดทางแยก</span>
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {pinIsBuilding ? "ชื่อตึก / อาคาร *" : "ชื่อจุดทางแยก *"}
                </label>
                <input
                  type="text"
                  required
                  value={pinName}
                  onChange={(e) => setPinName(e.target.value)}
                  placeholder={
                    pinIsBuilding
                      ? "เช่น อาคารรังสีรักษา"
                      : "เช่น ทางแยกหน้าป้อม รปภ."
                  }
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              {pinIsBuilding && (
                <>
                  {/* Category Selector */}
                  {categories.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        หมวดหมู่อาคาร
                      </label>
                      <select
                        value={pinCategoryId ?? ""}
                        onChange={(e) =>
                          setPinCategoryId(
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                        className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                      >
                        <option value="">-- เลือกหมวดหมู่ --</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Multi-Photo Upload with Client-side Compression */}
                  <div className="space-y-2 rounded-2xl bg-slate-50 border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-700 inline-flex items-center gap-1.5">
                        <ImageIcon className="w-4 h-4 text-[#0F766E]" />
                        <span>รูปถ่ายอาคาร ({pinImageUrls.length} รูป)</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <label className="min-h-[34px] px-2.5 rounded-xl bg-white hover:bg-teal-50 border border-slate-200 text-xs font-bold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer">
                          <Camera className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>ถ่ายรูป</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleUploadBuildingPhotos}
                            disabled={Boolean(photoUploadText)}
                            className="hidden"
                          />
                        </label>
                        <label className="min-h-[34px] px-2.5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                          {photoUploadText ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          <span>{photoUploadText || "เลือกหลายรูป"}</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleUploadBuildingPhotos}
                            disabled={Boolean(photoUploadText)}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    {pinImageUrls.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {pinImageUrls.map((url, idx) => (
                          <div
                            key={`${url}-${idx}`}
                            className="relative rounded-xl overflow-hidden border border-slate-200 aspect-[4/3] bg-white"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`รูปที่ ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            {idx === 0 && (
                              <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-[#0F766E]/90 text-white text-[9px] font-bold">
                                รูปปก
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setPinImageUrls((prev) =>
                                  prev.filter((u) => u !== url)
                                )
                              }
                              aria-label="ลบรูปนี้"
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/75 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Floor & Room Tag Builder */}
                  <div className="space-y-2.5 rounded-2xl bg-slate-50 border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700 inline-flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-[#0F766E]" />
                        <span>จำนวนชั้น และห้อง/แผนกในแต่ละชั้น</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleAddSurveyFloor}
                        className="min-h-[30px] px-2.5 rounded-full bg-teal-50 hover:bg-teal-100 border border-teal-200 text-[11px] font-bold text-[#0F766E] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>เพิ่มชั้น</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {pinFloors.map((fl) => (
                        <div
                          key={fl.id}
                          className="rounded-xl bg-white border border-slate-200 p-2.5 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={fl.floor}
                              onChange={(e) =>
                                setPinFloors((prev) =>
                                  prev.map((item) =>
                                    item.id === fl.id
                                      ? { ...item, floor: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="เช่น ชั้น 1, ชั้น G"
                              className="w-24 min-h-[32px] px-2.5 rounded-lg bg-teal-50 border border-teal-200 text-xs font-bold text-[#0F766E] focus:outline-none"
                            />
                            <span className="text-[11px] text-slate-400 flex-1">
                              {fl.rooms.length} ห้อง/แผนก
                            </span>
                            {pinFloors.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPinFloors((prev) =>
                                    prev.filter((item) => item.id !== fl.id)
                                  )
                                }
                                aria-label="ลบชั้นนี้"
                                className="w-7 h-7 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-[#BE123C] flex items-center justify-center cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {fl.rooms.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {fl.rooms.map((room) => (
                                <span
                                  key={room}
                                  className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-teal-50 border border-teal-200 text-[11px] font-bold text-[#0F766E]"
                                >
                                  <Stethoscope className="w-3 h-3 shrink-0" />
                                  <span>{room}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPinFloors((prev) =>
                                        prev.map((item) =>
                                          item.id === fl.id
                                            ? {
                                                ...item,
                                                rooms: item.rooms.filter(
                                                  (r) => r !== room
                                                ),
                                              }
                                            : item
                                        )
                                      )
                                    }
                                    className="w-4 h-4 rounded hover:bg-teal-200/70 flex items-center justify-center cursor-pointer"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={fl.draftRoom}
                              onChange={(e) =>
                                setPinFloors((prev) =>
                                  prev.map((item) =>
                                    item.id === fl.id
                                      ? { ...item, draftRoom: e.target.value }
                                      : item
                                  )
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddRoomTagToFloor(fl.id);
                                }
                              }}
                              placeholder="พิมพ์ห้อง/แผนก เช่น ห้องเอกซเรย์, ห้องผ่าตัด"
                              className="flex-1 min-h-[34px] px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-[#0F766E]"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddRoomTagToFloor(fl.id)}
                              disabled={!fl.draftRoom.trim()}
                              className="min-h-[34px] px-2.5 rounded-lg bg-slate-100 hover:bg-teal-50 disabled:opacity-40 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1 cursor-pointer shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>เพิ่ม</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      คำค้นหาเพิ่มเติม (ถ้ามี)
                    </label>
                    <input
                      type="text"
                      value={pinKeywords}
                      onChange={(e) => setPinKeywords(e.target.value)}
                      placeholder="เช่น NICU, OPD, รับยา"
                      className="w-full min-h-[40px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      คำแนะนำภายในอาคาร
                    </label>
                    <textarea
                      rows={2}
                      value={pinIndoorGuide}
                      onChange={(e) => setPinIndoorGuide(e.target.value)}
                      placeholder="เช่น เข้าประตูทิศใต้มีลิฟต์กลางโถง"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={isPinningNode || !activePinCoords}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {isPinningNode ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>บันทึกจุดนี้ลงแผนที่หลัก</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= SLIDE-UP SHEET: SAVED TRIPS & GPX IMPORT/EXPORT ================= */}
      {tripsSheetOpen && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[85dvh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                รายการสำรวจ &amp; นำเข้าไฟล์ GPX
              </h2>
              <button
                type="button"
                onClick={() => setTripsSheetOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setTripsTab("tracks")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    tripsTab === "tracks"
                      ? "bg-[#0F766E] text-white"
                      : "text-slate-600"
                  }`}
                >
                  รอยเดิน ({savedSurveys.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTripsTab("buildings")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    tripsTab === "buildings"
                      ? "bg-[#0F766E] text-white"
                      : "text-slate-600"
                  }`}
                >
                  อาคาร ({buildingList.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => gpxInputRef.current?.click()}
                disabled={isImportingGpx}
                className="h-9 px-3 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-[#0F766E] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isImportingGpx ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>นำเข้า .GPX</span>
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {tripsTab === "tracks" ? (
                savedSurveys.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">
                    ยังไม่มีรอยเดินสำรวจ สามารถกดปุ่ม &ldquo;เริ่มอัด&rdquo; หรือนำเข้าไฟล์ .GPX จากแอป Geo Tracker ได้เลย
                  </p>
                ) : (
                  savedSurveys.map((track) => {
                    const pts = Array.isArray(track.points_json)
                      ? track.points_json
                      : [];
                    const isCompleted = track.status === "completed";
                    return (
                      <div
                        key={track.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTrack(track);
                              setFollowGps(false);
                              setTripsSheetOpen(false);
                            }}
                            className="min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    track.color_hex || "#F97316",
                                }}
                              />
                              <p className="text-sm font-bold text-[#0F172A] truncate">
                                {track.name}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  isCompleted
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {isCompleted ? "เสร็จแล้ว" : "กำลังทำ"}
                              </span>
                              {track.zone && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 text-[10px] font-semibold">
                                  {track.zone}
                                </span>
                              )}
                              <span className="text-[11px] text-slate-500">
                                {pts.length} พิกัด
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleTrackStatus(track)}
                              title={
                                isCompleted
                                  ? "เปลี่ยนกลับเป็นกำลังทำ"
                                  : "ทำเครื่องหมายว่าเสร็จแล้ว"
                              }
                              className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer ${
                                isCompleted
                                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                  : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                              }`}
                            >
                              {isCompleted ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <Clock className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadGpx(track.name, pts)}
                              title="ดาวน์โหลดไฟล์ .GPX"
                              className="w-8 h-8 rounded-lg hover:bg-teal-50 text-[#0F766E] flex items-center justify-center cursor-pointer"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSavedTrack(track.id)}
                              title="ลบรอยเดิน"
                              className="w-8 h-8 rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1 border-t border-slate-200/70">
                          <button
                            type="button"
                            onClick={() => handleStartResumeTrack(track)}
                            className="flex-1 min-h-[34px] px-3 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <FastForward className="w-3.5 h-3.5" />
                            <span>อัดต่อจากรอยเดิม (Resume)</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )
              ) : buildingList.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  ยังไม่มีอาคารที่ปักพิกัดไว้
                </p>
              ) : (
                buildingList.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFocusCoords([b.lat, b.lng]);
                        setFollowGps(false);
                        setTripsSheetOpen(false);
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <p className="text-sm font-bold text-[#0F172A] truncate">
                        {b.name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono">
                        {b.lat.toFixed(5)}, {b.lng.toFixed(5)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePinnedNode(b)}
                      title="ลบอาคาร"
                      className="w-9 h-9 rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
