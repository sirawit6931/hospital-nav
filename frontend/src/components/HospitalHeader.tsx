"use client";

import Link from "next/link";
import { Crosshair, Hospital, Lock } from "lucide-react";

interface HospitalHeaderProps {
  gpsStatus: "idle" | "locating" | "ready" | "fallback";
  onLocateMe: () => void;
}

export default function HospitalHeader({
  gpsStatus,
  onLocateMe,
}: HospitalHeaderProps) {
  return (
    <header className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shrink-0 shadow-sm">
          <Hospital className="w-6 h-6" strokeWidth={2.2} />
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

        <Link
          href="/admin/login"
          title="เข้าสู่ระบบสำหรับเจ้าหน้าที่"
          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-[#0F766E] flex items-center justify-center transition-colors"
          aria-label="เข้าสู่ระบบสำหรับเจ้าหน้าที่"
        >
          <Lock className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}
