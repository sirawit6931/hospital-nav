"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  Play,
  Save,
  ShieldAlert,
  Smartphone,
  Square,
  Trash2,
} from "lucide-react";
import {
  api,
  extractApiError,
  getAdminToken,
  type MapNode,
  type SurveyTrack,
  type UploadResponse,
} from "@/lib/api";
import { calculateDistanceMeters } from "@/lib/hospital";

const SurveyLiveMap = dynamic(
  () => import("@/components/maps/SurveyLiveMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#0F766E]" />
        <span className="text-sm">กำลังเปิดแผนที่ภาคสนาม...</span>
      </div>
    ),
  }
);

export default function AdminSurveyPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [currentCoords, setCurrentCoords] = useState<[number, number] | null>(
    null
  );
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Track recording state
  const [isRecording, setIsRecording] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [trackPoints, setTrackPoints] = useState<[number, number][]>([]);
  const [trackName, setTrackName] = useState("");
  const [isSavingTrack, setIsSavingTrack] = useState(false);

  // Field Building / Point Pinning state
  const [pinIsBuilding, setPinIsBuilding] = useState(true);
  const [pinName, setPinName] = useState("");
  const [pinKeywords, setPinKeywords] = useState("");
  const [pinIndoorGuide, setPinIndoorGuide] = useState("");
  const [pinImageUrl, setPinImageUrl] = useState("");
  const [draftPinCoords, setDraftPinCoords] = useState<[number, number] | null>(
    null
  );
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isPinningNode, setIsPinningNode] = useState(false);

  // Saved items lists
  const [pinnedNodes, setPinnedNodes] = useState<MapNode[]>([]);
  const [savedSurveys, setSavedSurveys] = useState<SurveyTrack[]>([]);
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isRecordingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const notify = useCallback((type: "success" | "error", text: string) => {
    setStatusBanner({ type, text });
    setTimeout(() => {
      setStatusBanner((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  const loadFieldData = useCallback(async () => {
    try {
      const [nodesRes, surveysRes] = await Promise.all([
        api.get<MapNode[]>("/api/admin/nodes"),
        api.get<SurveyTrack[]>("/api/admin/surveys"),
      ]);
      setPinnedNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setSavedSurveys(Array.isArray(surveysRes.data) ? surveysRes.data : []);
    } catch {
      // Ignore silent load error on init
    }
  }, []);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      router.replace("/admin/login");
      return;
    }
    setAuthChecked(true);
    loadFieldData();
  }, [router, loadFieldData]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Continuous high-accuracy GPS watcher
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
        setCurrentCoords([lat, lng]);
        setAccuracyMeters(Math.round(pos.coords.accuracy));
        setGpsError(null);

        if (isRecordingRef.current) {
          setTrackPoints((prev) => {
            if (prev.length === 0) return [[lat, lng]];
            const last = prev[prev.length - 1];
            const movedMeters = calculateDistanceMeters(
              last[0],
              last[1],
              lat,
              lng
            );
            if (movedMeters < 2) return prev;
            return [...prev, [lat, lng]];
          });
        }
      },
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "กรุณาอนุญาตการเข้าถึงตำแหน่ง GPS ของเบราว์เซอร์ (หรือแตะบนแผนที่เพื่อเลือกพิกัดเอง)"
            : "ไม่สามารถรับสัญญาณ GPS ได้ สามารถแตะเลือกพิกัดบนแผนที่เพื่อปักชื่อตึกได้ทันที"
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [authChecked]);

  // Screen Wake Lock management while recording
  const requestWakeLock = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
        return;
      }
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
      // Ignore release errors
    } finally {
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    if (!isRecording) {
      releaseWakeLock();
      return;
    }

    requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isRecordingRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      releaseWakeLock();
    };
  }, [isRecording, requestWakeLock, releaseWakeLock]);

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

  const activePinCoords = draftPinCoords || currentCoords;

  const handleToggleRecording = () => {
    if (!isRecording) {
      if (currentCoords) {
        setTrackPoints((prev) =>
          prev.length === 0 ? [currentCoords] : prev
        );
      }
      setIsRecording(true);
      notify("success", "เริ่มบันทึกรอยเดินสำรวจแล้ว (เปิดกันจอดับอัตโนมัติ)");
    } else {
      setIsRecording(false);
      notify("success", "หยุดบันทึกรอยเดินแล้ว พร้อมส่งข้อมูลเข้าระบบ");
    }
  };

  const handleDropPointHere = () => {
    const pt = activePinCoords;
    if (!pt) {
      notify("error", "ยังไม่มีพิกัด GPS กรุณารอสัญญาณหรือแตะบนแผนที่");
      return;
    }
    setTrackPoints((prev) => [...prev, pt]);
    notify("success", "ปักพิกัดลงในรอยเดินเรียบร้อยแล้ว");
  };

  const handleUploadBuildingPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post<UploadResponse>("/api/admin/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPinImageUrl(res.data.image_url || res.data.url);
      notify("success", "อัปโหลดภาพถ่ายหน้าอาคารเรียบร้อยแล้ว");
    } catch (err) {
      notify("error", extractApiError(err, "อัปโหลดรูปภาพไม่สำเร็จ"));
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = "";
    }
  };

  const handleSaveBuildingOrPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePinCoords) {
      notify(
        "error",
        "ยังไม่มีพิกัดที่จะบันทึก กรุณารอสัญญาณ GPS หรือแตะเลือกตำแหน่งบนแผนที่"
      );
      return;
    }
    const trimmedName = pinName.trim();
    if (!trimmedName) {
      notify(
        "error",
        pinIsBuilding
          ? "กรุณากรอกชื่อตึก/อาคารก่อนบันทึก"
          : "กรุณากรอกชื่อจุดทางแยกก่อนบันทึก"
      );
      return;
    }

    setIsPinningNode(true);
    try {
      const res = await api.post<MapNode>("/api/admin/nodes", {
        name: trimmedName,
        is_building: pinIsBuilding,
        keywords: pinIsBuilding ? pinKeywords.trim() : "",
        indoor_guide: pinIsBuilding ? pinIndoorGuide.trim() : "",
        image_url: pinIsBuilding ? pinImageUrl.trim() : "",
        lat: activePinCoords[0],
        lng: activePinCoords[1],
      });
      setPinnedNodes((prev) => [res.data, ...prev]);
      setPinName("");
      setPinKeywords("");
      setPinIndoorGuide("");
      setPinImageUrl("");
      setDraftPinCoords(null);
      notify(
        "success",
        pinIsBuilding
          ? `บันทึกอาคาร "${res.data.name}" ลงแผนที่หลัก (2D/3D) เรียบร้อยแล้ว`
          : `บันทึกจุดทางแยก "${res.data.name}" เรียบร้อยแล้ว`
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
      notify("success", `ลบ "${node.name || `จุด #${node.id}`}" ออกจากระบบแล้ว`);
    } catch (err) {
      notify("error", extractApiError(err, "ลบจุดไม่สำเร็จ"));
    }
  };

  const handleSaveSurveyTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (trackPoints.length < 2) {
      notify("error", "ต้องมีอย่างน้อย 2 พิกัดก่อนบันทึกรอยเดิน");
      return;
    }
    const nameToSave =
      trackName.trim() ||
      `รอยเดินสำรวจ ${new Date().toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;

    setIsSavingTrack(true);
    try {
      const res = await api.post<SurveyTrack>("/api/admin/surveys", {
        name: nameToSave,
        points_json: trackPoints,
      });
      setSavedSurveys((prev) => [res.data, ...prev]);
      setTrackPoints([]);
      setTrackName("");
      setIsRecording(false);
      notify("success", `บันทึกรอยเดิน "${res.data.name}" เรียบร้อยแล้ว`);
    } catch (err) {
      notify("error", extractApiError(err, "ไม่สามารถบันทึกรอยเดินได้"));
    } finally {
      setIsSavingTrack(false);
    }
  };

  const handleDeleteSavedTrack = async (id: number) => {
    try {
      await api.delete(`/api/admin/surveys/${id}`);
      setSavedSurveys((prev) => prev.filter((s) => s.id !== id));
      notify("success", "ลบรอยเดินสำรวจแล้ว");
    } catch (err) {
      notify("error", extractApiError(err, "ลบรอยเดินไม่สำเร็จ"));
    }
  };

  if (!authChecked) {
    return (
      <div className="h-dvh bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
      </div>
    );
  }

  const accuracyBadge =
    accuracyMeters === null
      ? { label: "รอสัญญาณ", cls: "bg-slate-100 text-slate-600" }
      : accuracyMeters <= 10
      ? {
          label: `แม่นยำมาก ±${accuracyMeters} ม.`,
          cls: "bg-[#CCFBF1] text-[#047857]",
        }
      : accuracyMeters <= 25
      ? {
          label: `ปานกลาง ±${accuracyMeters} ม.`,
          cls: "bg-amber-100 text-amber-800",
        }
      : {
          label: `สัญญาณอ่อน ±${accuracyMeters} ม.`,
          cls: "bg-[#FFE4E6] text-[#BE123C]",
        };

  const buildingList = pinnedNodes.filter((n) => n.is_building);

  return (
    <div className="min-h-dvh bg-[#F8FAFC] flex flex-col">
      {/* Mobile-First Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href="/admin/map"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center justify-center shrink-0"
            aria-label="กลับหน้า Admin Map Editor"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-heading text-base font-bold text-[#0F172A] truncate">
              เก็บพิกัดภาคสนาม (GPS Survey)
            </h1>
            <p className="text-xs text-slate-500 truncate">
              ปักจุดใส่ชื่อตึก &amp; เดินบันทึกรอยทางเดินจริง รพ.สกลนคร
            </p>
          </div>
        </div>

        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
            wakeLockActive
              ? "bg-[#CCFBF1] text-[#047857]"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>{wakeLockActive ? "กันจอดับ: เปิด" : "กันจอดับ: รอ"}</span>
        </span>
      </header>

      <main className="max-w-xl w-full mx-auto flex-1 p-4 space-y-4 pb-10">
        {statusBanner && (
          <div
            className={`rounded-xl px-4 py-3 text-sm font-semibold border flex items-center gap-2.5 ${
              statusBanner.type === "success"
                ? "bg-[#CCFBF1] text-[#047857] border-teal-200"
                : "bg-[#FFE4E6] text-[#BE123C] border-rose-200"
            }`}
          >
            {statusBanner.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <ShieldAlert className="w-5 h-5 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
        )}

        {gpsError && (
          <div className="rounded-xl bg-[#FFE4E6] border border-rose-200 px-4 py-3 flex items-start gap-2.5 text-sm text-[#BE123C]">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="font-medium">{gpsError}</span>
          </div>
        )}

        {/* Live GPS Telemetry & Interactive Satellite Map */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
              <Crosshair className="w-4 h-4 text-[#0F766E]" />
              <span>สัญญาณ GPS และแผนที่ภาคสนาม</span>
            </div>
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-bold ${accuracyBadge.cls}`}
            >
              {accuracyBadge.label}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
              <div className="text-[11px] font-semibold text-slate-500">
                พิกัดที่เลือก
              </div>
              <div className="text-xs font-bold text-[#0F172A] mt-1 font-mono">
                {activePinCoords
                  ? `${activePinCoords[0].toFixed(5)}, ${activePinCoords[1].toFixed(
                      5
                    )}`
                  : "รอสัญญาณ..."}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
              <div className="text-[11px] font-semibold text-slate-500">
                จุดในรอยเดิน
              </div>
              <div className="font-heading text-lg font-bold text-[#0F766E]">
                {trackPoints.length}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
              <div className="text-[11px] font-semibold text-slate-500">
                ระยะทางสะสม
              </div>
              <div className="font-heading text-lg font-bold text-[#0F172A]">
                {totalTrackDistanceM} ม.
              </div>
            </div>
          </div>

          {/* Live Interactive Satellite Map (tap map to adjust pin position) */}
          <div className="h-64 w-full rounded-xl overflow-hidden border border-slate-200 relative">
            <SurveyLiveMap
              currentCoords={currentCoords}
              accuracyMeters={accuracyMeters}
              trackPoints={trackPoints}
              pinnedNodes={pinnedNodes}
              draftPinCoords={draftPinCoords}
              onMapTapToAdjustPin={(lat, lng) => setDraftPinCoords([lat, lng])}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              แตะบนแผนที่เพื่อปรับตำแหน่งหมุดให้ตรงหลังคาตึก หรือใช้พิกัด GPS ที่ยืนอยู่
            </span>
            {draftPinCoords && (
              <button
                type="button"
                onClick={() => setDraftPinCoords(null)}
                className="shrink-0 font-bold text-[#0F766E] hover:underline cursor-pointer"
              >
                กลับใช้พิกัด GPS
              </button>
            )}
          </div>
        </section>

        {/* ========== SECTION 1: ADD BUILDING / POINT WITH NAME ========== */}
        <section className="rounded-2xl bg-white border-2 border-teal-200 p-4 space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                  ปักจุดและใส่ชื่อตึกภาคสนาม
                </h2>
                <p className="text-xs text-slate-500">
                  บันทึกตรงเข้าฐานข้อมูลแผนที่หลัก (2D และ 3D) ทันที
                </p>
              </div>
            </div>
          </div>

          {/* Type Toggle: Building vs Walkway Junction */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPinIsBuilding(true)}
              className={`min-h-[46px] px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                pinIsBuilding
                  ? "bg-[#0F766E] border-[#0F766E] text-white shadow-xs"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-teal-50"
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>เพิ่มตึก / อาคาร</span>
            </button>
            <button
              type="button"
              onClick={() => setPinIsBuilding(false)}
              className={`min-h-[46px] px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                !pinIsBuilding
                  ? "bg-[#1D4ED8] border-[#1D4ED8] text-white shadow-xs"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-blue-50"
              }`}
            >
              <MapPin className="w-4 h-4" />
              <span>เพิ่มจุดทางแยก</span>
            </button>
          </div>

          <form onSubmit={handleSaveBuildingOrPoint} className="space-y-3">
            {/* Building / Point Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {pinIsBuilding ? "ชื่อตึก / อาคาร *" : "ชื่อจุดทางแยก / ทางเข้า *"}
              </label>
              <input
                type="text"
                required
                value={pinName}
                onChange={(e) => setPinName(e.target.value)}
                placeholder={
                  pinIsBuilding
                    ? "เช่น ตึก 10 ชั้น (ตึกร่มเย็น), อาคารรังสีรักษา"
                    : "เช่น ทางแยกหน้าป้อม รปภ., ทางเข้าลิฟต์ด้านข้าง"
                }
                className="w-full min-h-[48px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
              />
            </div>

            {pinIsBuilding && (
              <>
                {/* Keywords / Departments */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    แผนก / คำค้นหาภายในตึก (คั่นด้วยจุลภาค)
                  </label>
                  <input
                    type="text"
                    value={pinKeywords}
                    onChange={(e) => setPinKeywords(e.target.value)}
                    placeholder="เช่น NICU, PICU, ตา, หู คอ จมูก, จุดชำระเงิน, รับยา"
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                  />
                </div>

                {/* Indoor Guide */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    คำแนะนำรายชั้น / ภายในอาคาร (Indoor Guide)
                  </label>
                  <textarea
                    rows={2}
                    value={pinIndoorGuide}
                    onChange={(e) => setPinIndoorGuide(e.target.value)}
                    placeholder="เช่น ชั้น 1 รับยาและชำระเงิน, ชั้น 2 คลินิกผิวหนัง"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                  />
                </div>

                {/* Take / Upload Building Front Photo */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-xs font-bold text-slate-800 inline-flex items-center gap-2 cursor-pointer">
                      {isUploadingPhoto ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#0F766E]" />
                      ) : (
                        <Camera className="w-4 h-4 text-[#0F766E]" />
                      )}
                      <span>
                        {isUploadingPhoto
                          ? "กำลังอัปโหลด..."
                          : "ถ่ายภาพ / แนบรูปหน้าตึก"}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleUploadBuildingPhoto}
                        disabled={isUploadingPhoto}
                        className="hidden"
                      />
                    </label>
                    {pinImageUrl && (
                      <button
                        type="button"
                        onClick={() => setPinImageUrl("")}
                        className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
                      >
                        ลบรูป
                      </button>
                    )}
                  </div>

                  {pinImageUrl && (
                    <div className="rounded-xl overflow-hidden border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pinImageUrl}
                        alt="ตัวอย่างภาพหน้าอาคาร"
                        className="w-full h-32 object-cover"
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isPinningNode || !activePinCoords}
              className={`w-full min-h-[50px] px-4 rounded-xl disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer ${
                pinIsBuilding
                  ? "bg-[#047857] hover:bg-emerald-800"
                  : "bg-[#1D4ED8] hover:bg-blue-800"
              }`}
            >
              {isPinningNode ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : pinIsBuilding ? (
                <Building2 className="w-4 h-4" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              <span>
                {pinIsBuilding
                  ? "บันทึกตึกนี้ลงแผนที่หลัก"
                  : "บันทึกจุดทางแยกนี้ลงแผนที่หลัก"}
              </span>
            </button>
          </form>
        </section>

        {/* ========== SECTION 2: WALKING TRACK RECORDER ========== */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <h2 className="font-heading text-sm font-bold text-[#0F172A]">
            บันทึกรอยเดินสำรวจทางเดิน (Survey Track)
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleToggleRecording}
              className={`min-h-[52px] px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer ${
                isRecording
                  ? "bg-[#BE123C] hover:bg-rose-800 text-white"
                  : "bg-[#0F766E] hover:bg-[#115E59] text-white"
              }`}
            >
              {isRecording ? (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  <span>หยุดบันทึกรอยเดิน</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>เริ่มบันทึกรอยเดิน</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDropPointHere}
              disabled={!activePinCoords}
              className="min-h-[52px] px-4 rounded-xl bg-white border-2 border-[#0F766E] text-[#0F766E] hover:bg-teal-50 disabled:opacity-50 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <MapPin className="w-4 h-4" />
              <span>เพิ่มจุดลงรอยเดิน</span>
            </button>
          </div>

          <form onSubmit={handleSaveSurveyTrack} className="space-y-2.5 pt-1">
            <input
              type="text"
              value={trackName}
              onChange={(e) => setTrackName(e.target.value)}
              placeholder="ตั้งชื่อเส้นทางสำรวจ เช่น หน้าตึก ER ถึง ตึก 10 ชั้น ร่มเย็น"
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
            />

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isSavingTrack || trackPoints.length < 2}
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSavingTrack ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>ส่งรอยเดินเข้าระบบ ({trackPoints.length} จุด)</span>
              </button>

              {trackPoints.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTrackPoints([])}
                  className="min-h-[46px] px-3.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-sm font-semibold cursor-pointer"
                >
                  ล้างจุด
                </button>
              )}
            </div>
          </form>
        </section>

        {/* ========== SECTION 3: PINNED BUILDINGS IN SYSTEM ========== */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <h2 className="font-heading text-sm font-bold text-[#0F172A]">
            อาคารที่ปักพิกัดไว้ในระบบ ({buildingList.length} อาคาร)
          </h2>

          {buildingList.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ยังไม่มีอาคารที่บันทึกไว้
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {buildingList.map((node) => (
                <div
                  key={node.id}
                  className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F172A] truncate">
                      {node.name || `อาคาร #${node.id}`}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePinnedNode(node)}
                    className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 cursor-pointer"
                    aria-label={`ลบ ${node.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ========== SECTION 4: SAVED SURVEY TRACKS ========== */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <h2 className="font-heading text-sm font-bold text-[#0F172A]">
            รอยเดินที่บันทึกไว้ในระบบ ({savedSurveys.length})
          </h2>

          {savedSurveys.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              ยังไม่มีรอยเดินสำรวจที่บันทึกไว้
            </p>
          ) : (
            <div className="space-y-2">
              {savedSurveys.map((track) => (
                <div
                  key={track.id}
                  className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F172A] truncate">
                      {track.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {Array.isArray(track.points_json)
                        ? track.points_json.length
                        : 0}{" "}
                      พิกัด
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteSavedTrack(track.id)}
                    className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center cursor-pointer"
                    aria-label={`ลบ ${track.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
