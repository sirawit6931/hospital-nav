"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Crosshair } from "lucide-react";

interface HospitalHeaderProps {
  gpsStatus: "idle" | "locating" | "ready" | "fallback";
  onLocateMe: () => void;
}

const ADMIN_SECRET_TAPS = 5;
const TAP_WINDOW_MS = 1800;

export default function HospitalHeader({
  gpsStatus,
  onLocateMe,
}: HospitalHeaderProps) {
  const router = useRouter();
  const tapCountRef = useRef(0);
  const lastTapAtRef = useRef(0);

  const handleLogoTap = () => {
    const now = Date.now();
    if (now - lastTapAtRef.current > TAP_WINDOW_MS) {
      tapCountRef.current = 1;
    } else {
      tapCountRef.current += 1;
    }
    lastTapAtRef.current = now;

    if (tapCountRef.current >= ADMIN_SECRET_TAPS) {
      tapCountRef.current = 0;
      router.push("/admin/login");
    }
  };

  return (
    <header className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          onClick={handleLogoTap}
          className="h-12 w-auto flex items-center justify-center shrink-0 select-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sakon-hospital-logo.png"
            alt="โลโก้โรงพยาบาลสกลนคร"
            className="h-12 w-auto object-contain"
          />
        </div>
        <div className="min-w-0">
          <h1 className="font-heading text-[17px] leading-tight font-bold text-[#0F172A] truncate">
            โรงพยาบาลสกลนคร
          </h1>
          <p className="text-[13px] leading-snug text-slate-500 truncate">
            ระบบนำทางอาคารและแผนกบริการ
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onLocateMe}
          title="อัปเดตตำแหน่ง GPS ปัจจุบัน"
          className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
            gpsStatus === "ready"
              ? "bg-teal-50 border-teal-200 text-[#0F766E] hover:bg-teal-100"
              : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
          }`}
        >
          <Crosshair
            className={`w-4 h-4 ${
              gpsStatus === "locating" ? "animate-spin text-[#0F766E]" : ""
            }`}
          />
          <span className="hidden sm:inline">
            {gpsStatus === "ready"
              ? "GPS พร้อม"
              : gpsStatus === "locating"
              ? "กำลังหาพิกัด"
              : "ใช้พิกัด รพ."}
          </span>
        </button>
      </div>
    </header>
  );
}
