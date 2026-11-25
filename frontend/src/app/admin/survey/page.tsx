"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Compass,
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
  type SurveyTrack,
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

  const [isRecording, setIsRecording] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [trackPoints, setTrackPoints] = useState<[number, number][]>([]);
  const [trackName, setTrackName] = useState("");
  const [isSavingTrack, setIsSavingTrack] = useState(false);
  const [isPinningNode, setIsPinningNode] = useState(false);
  const [quickNodeName, setQuickNodeName] = useState("");
  const [showPinNodeBox, setShowPinNodeBox] = useState(false);

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

  const loadSurveys = useCallback(async () => {
    try {
      const res = await api.get<SurveyTrack[]>("/api/admin/surveys");
      setSavedSurveys(Array.isArray(res.data) ? res.data : []);
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
    loadSurveys();
  }, [router, loadSurveys]);

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
            // Filter minor GPS drift (< 2 meters) while standing still
            if (movedMeters < 2) return prev;
            return [...prev, [lat, lng]];
          });
        }
      },
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "กรุณาอนุญาตการเข้าถึงตำแหน่ง GPS ของเบราว์เซอร์"
            : "ไม่สามารถรับสัญญาณ GPS ได้ กรุณาลองออกไปยังพื้นที่โล่ง"
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
    if (!currentCoords) {
      notify("error", "ยังไม่มีพิกัด GPS ปัจจุบัน กรุณารอสัญญาณสักครู่");
      return;
    }
    setTrackPoints((prev) => [...prev, currentCoords]);
    notify("success", "ปักพิกัดจุดที่ยืนลงในรอยเดินเรียบร้อยแล้ว");
  };

  const handleSaveCurrentPointAsNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCoords) {
      notify("error", "ยังไม่มีพิกัด GPS ปัจจุบัน");
      return;
    }
    setIsPinningNode(true);
    try {
      await api.post("/api/admin/nodes", {
        name: quickNodeName.trim() || "จุดสำรวจภาคสนาม",
        is_building: false,
        keywords: "",
        indoor_guide: "",
        image_url: "",
        lat: currentCoords[0],
        lng: currentCoords[1],
      });
      setQuickNodeName("");
      setShowPinNodeBox(false);
      notify("success", "บันทึกจุดที่ยืนเป็น Node บนแผนที่หลักเรียบร้อยแล้ว");
    } catch (err) {
      notify("error", extractApiError(err, "ไม่สามารถบันทึกจุดได้"));
    } finally {
      setIsPinningNode(false);
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
      ? { label: `แม่นยำมาก ±${accuracyMeters} ม.`, cls: "bg-[#CCFBF1] text-[#047857]" }
      : accuracyMeters <= 25
      ? { label: `ปานกลาง ±${accuracyMeters} ม.`, cls: "bg-amber-100 text-amber-800" }
      : { label: `สัญญาณอ่อน ±${accuracyMeters} ม.`, cls: "bg-[#FFE4E6] text-[#BE123C]" };

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
              เดินบันทึกรอยทางเดินจริงสำหรับวาดแผนที่ รพ.สกลนคร
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

        {/* Live GPS Telemetry Card */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
              <Crosshair className="w-4 h-4 text-[#0F766E]" />
              <span>สถานะสัญญาณ GPS ปัจจุบัน</span>
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
                พิกัดปัจจุบัน
              </div>
              <div className="text-xs font-bold text-[#0F172A] mt-1 font-mono">
                {currentCoords
                  ? `${currentCoords[0].toFixed(5)}, ${currentCoords[1].toFixed(
                      5
                    )}`
                  : "กำลังค้นหา..."}
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
              <div className="text-[11px] font-semibold text-slate-500">
                จุดที่บันทึก
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

          {/* Live Mini Satellite Map */}
          <div className="h-56 w-full rounded-xl overflow-hidden border border-slate-200">
            <SurveyLiveMap
              currentCoords={currentCoords}
              accuracyMeters={accuracyMeters}
              trackPoints={trackPoints}
            />
          </div>
        </section>

        {/* Primary Field Action Controls */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleToggleRecording}
            className={`min-h-[54px] px-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2.5 shadow-sm transition-colors cursor-pointer ${
              isRecording
                ? "bg-[#BE123C] hover:bg-rose-800 text-white"
                : "bg-[#0F766E] hover:bg-[#115E59] text-white"
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-5 h-5 fill-current" />
                <span>หยุดบันทึกรอยเดิน</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>เริ่มบันทึกรอยเดิน</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDropPointHere}
            disabled={!currentCoords}
            className="min-h-[54px] px-4 rounded-2xl bg-white border-2 border-[#0F766E] text-[#0F766E] hover:bg-teal-50 disabled:opacity-50 text-base font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <MapPin className="w-5 h-5" />
            <span>ปักจุดที่ยืนลงเส้น</span>
          </button>
        </section>

        {/* Quick Pin Point directly as MapNode */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-[#0F766E]" />
              <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                ปักหมุดจุดสำคัญลงแผนที่หลักทันที
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowPinNodeBox((prev) => !prev)}
              className="text-xs font-bold text-[#0F766E] hover:underline cursor-pointer"
            >
              {showPinNodeBox ? "ซ่อน" : "เปิดฟอร์ม"}
            </button>
          </div>

          {showPinNodeBox && (
            <form
              onSubmit={handleSaveCurrentPointAsNode}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={quickNodeName}
                onChange={(e) => setQuickNodeName(e.target.value)}
                placeholder="ชื่อจุด เช่น ทางแยกหน้าห้องยา, ทางขึ้นลิฟต์"
                className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:bg-white focus:outline-none focus:border-[#0F766E]"
              />
              <button
                type="submit"
                disabled={isPinningNode || !currentCoords}
                className="min-h-[46px] px-4 rounded-xl bg-[#047857] hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {isPinningNode ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MapPin className="w-4 h-4" />
                )}
                <span>บันทึก Node</span>
              </button>
            </form>
          )}
        </section>

        {/* Save Recorded Survey Track Form */}
        <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <h2 className="font-heading text-sm font-bold text-[#0F172A]">
            บันทึกรอยเดินเข้าระบบ (Survey Track)
          </h2>

          <form onSubmit={handleSaveSurveyTrack} className="space-y-3">
            <input
              type="text"
              value={trackName}
              onChange={(e) => setTrackName(e.target.value)}
              placeholder="ตั้งชื่อเส้นทางสำรวจ เช่น หน้าตึก ER ถึง ตึก 8 ชั้น"
              className="w-full min-h-[48px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
            />

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isSavingTrack || trackPoints.length < 2}
                className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
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
                  className="min-h-[48px] px-3.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-sm font-semibold cursor-pointer"
                >
                  ล้างจุด
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Previously Saved Tracks List */}
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
