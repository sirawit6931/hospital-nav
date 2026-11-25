"use client";

import {
  Accessibility,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  Clock,
  Footprints,
  Info,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { MapNode, RouteResponse } from "@/lib/api";
import { buildTurnByTurnSteps, classifyBuilding } from "@/lib/hospital";

interface RoutePanelProps {
  buildings: MapNode[];
  originLabel: string;
  originMode: "gps" | "building";
  originBuildingId: number | null;
  targetBuilding: MapNode | null;
  routeData: RouteResponse | null;
  isLoadingRoute: boolean;
  routeError: string | null;
  onChangeOriginMode: (mode: "gps" | "building", buildingId?: number) => void;
  onSwapOriginAndTarget: () => void;
  onPickTargetTab: () => void;
  onRetryRoute: () => void;
  compactHeaderOnly?: boolean;
}

export default function RoutePanel({
  buildings,
  originLabel,
  originMode,
  originBuildingId,
  targetBuilding,
  routeData,
  isLoadingRoute,
  routeError,
  onChangeOriginMode,
  onSwapOriginAndTarget,
  onPickTargetTab,
  onRetryRoute,
  compactHeaderOnly = false,
}: RoutePanelProps) {
  const originDestinationCard = (
    <div className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Origin row */}
          <div className="flex items-center gap-2.5">
            <span className="w-3.5 h-3.5 rounded-full border-[3px] border-[#0F766E] bg-white shrink-0" />
            <div className="flex-1 min-w-0">
              <label htmlFor="origin-selector" className="sr-only">
                จุดเริ่มต้น
              </label>
              <select
                id="origin-selector"
                value={
                  originMode === "gps"
                    ? "gps"
                    : originBuildingId
                    ? String(originBuildingId)
                    : "gps"
                }
                onChange={(e) => {
                  if (e.target.value === "gps") {
                    onChangeOriginMode("gps");
                  } else {
                    onChangeOriginMode("building", Number(e.target.value));
                  }
                }}
                className="w-full min-h-[38px] text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-[#0F766E]"
              >
                <option value="gps">จาก: {originMode === "gps" ? originLabel : "ตำแหน่งปัจจุบัน (GPS)"}</option>
                {buildings.map((b) => (
                  <option key={`origin-${b.id}`} value={String(b.id)}>
                    จาก: {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Destination row */}
          <div className="flex items-center gap-2.5">
            <MapPin className="w-4 h-4 text-[#BE123C] shrink-0" />
            <div className="flex-1 min-w-0 flex items-center justify-between gap-2 bg-rose-50/60 border border-rose-100 rounded-lg px-2.5 py-1.5 min-h-[38px]">
              <span className="text-sm font-bold text-[#0F172A] truncate">
                {targetBuilding
                  ? `ไป: ${targetBuilding.name}`
                  : "กรุณาเลือกอาคารปลายทาง"}
              </span>
              <button
                type="button"
                onClick={onPickTargetTab}
                className="shrink-0 text-xs font-bold text-[#0F766E] hover:underline px-1 cursor-pointer"
              >
                เปลี่ยน
              </button>
            </div>
          </div>
        </div>

        {/* Swap Origin/Target Button */}
        <button
          type="button"
          onClick={onSwapOriginAndTarget}
          disabled={!targetBuilding}
          title="สลับต้นทางและปลายทาง"
          aria-label="สลับต้นทางและปลายทาง"
          className="min-h-[44px] min-w-[44px] rounded-full border border-slate-200 bg-slate-50 hover:bg-teal-50 hover:border-teal-300 text-[#0F766E] disabled:opacity-40 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
        >
          <ArrowUpDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  if (compactHeaderOnly) {
    return originDestinationCard;
  }

  const steps = routeData ? buildTurnByTurnSteps(routeData, originLabel) : [];
  const targetBadge = routeData?.target_building
    ? classifyBuilding(routeData.target_building)
    : targetBuilding
    ? classifyBuilding(targetBuilding)
    : null;
  const roundedDist = routeData ? Math.round(routeData.total_distance_m) : 0;
  const roundedMin = routeData
    ? Math.max(1, Math.round(routeData.estimated_walk_min))
    : 0;

  return (
    <div className="space-y-4">
      {originDestinationCard}

      {/* Loading State */}
      {isLoadingRoute && (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col items-center justify-center text-center gap-2.5">
          <Loader2 className="w-7 h-7 text-[#0F766E] animate-spin" />
          <p className="text-sm font-semibold text-slate-700">
            กำลังคำนวณเส้นทางเดินที่สั้นที่สุด...
          </p>
        </div>
      )}

      {/* Unreachable / Error State */}
      {!isLoadingRoute && routeError && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FFE4E6] text-[#BE123C] flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-heading text-sm font-bold text-[#BE123C]">
                ไม่สามารถนำทางได้ในขณะนี้
              </h3>
              <p className="text-sm text-rose-900/90 mt-1 leading-relaxed">
                {routeError}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetryRoute}
              className="min-h-[44px] px-4 rounded-xl bg-[#BE123C] hover:bg-rose-800 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>ลองคำนวณใหม่</span>
            </button>
            <button
              type="button"
              onClick={onPickTargetTab}
              className="min-h-[44px] px-4 rounded-xl bg-white border border-rose-200 text-rose-800 text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <span>เลือกอาคารอื่น</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty State when no target selected */}
      {!isLoadingRoute && !routeError && !routeData && (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-[#0F766E] mx-auto flex items-center justify-center">
            <Navigation className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-heading text-base font-bold text-[#0F172A]">
              เลือกอาคารเพื่อเริ่มนำทาง
            </h3>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              แตะที่หมุดอาคารบนแผนที่ หรือเลือกจากรายชื่ออาคารในแท็บค้นหาตึก
            </p>
          </div>
          <button
            type="button"
            onClick={onPickTargetTab}
            className="min-h-[44px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <span>ค้นหารายชื่อตึก</span>
          </button>
        </div>
      )}

      {/* Active Route Summary & Turn-by-Turn Guidance */}
      {!isLoadingRoute && !routeError && routeData && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
          {/* Header summary */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0F766E] uppercase tracking-wide">
                เส้นทางเดินแนะนำ
              </p>
              <h3 className="font-heading text-[17px] font-bold text-[#0F172A] leading-snug mt-0.5">
                {routeData.target_building.name}
              </h3>
              {targetBadge && (
                <span
                  className="inline-flex items-center mt-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border"
                  style={{
                    color: targetBadge.badgeStyle.text,
                    backgroundColor: targetBadge.badgeStyle.bg,
                    borderColor: targetBadge.badgeStyle.border,
                  }}
                >
                  {targetBadge.badgeLabel}
                </span>
              )}
            </div>

            <div className="shrink-0 rounded-xl bg-[#0F766E] text-white px-3.5 py-2 text-right shadow-sm">
              <div className="flex items-center justify-end gap-1.5 font-heading text-base font-bold leading-none">
                <Clock className="w-4 h-4" />
                <span>{roundedMin} นาที</span>
              </div>
              <div className="text-xs text-teal-100 mt-1 font-medium">
                {roundedDist} ม.
              </div>
            </div>
          </div>

          {/* Accessibility & Status Pills */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#DBEAFE] text-[#1D4ED8] text-xs font-semibold">
              <Accessibility className="w-3.5 h-3.5" />
              <span>รองรับทางลาดรถเข็น</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#CCFBF1] text-[#047857] text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>เส้นทางเปิดใช้งานปกติ</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold">
              <Footprints className="w-3.5 h-3.5" />
              <span>ความเร็วเดิน ~80 ม./นาที</span>
            </span>
          </div>

          {/* Target Building Photo (if uploaded) */}
          {routeData.target_building.image_url && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routeData.target_building.image_url}
                alt={`ภาพหน้าอาคาร ${routeData.target_building.name}`}
                className="w-full h-40 object-cover"
              />
            </div>
          )}

          {/* Turn-by-Turn Guidance */}
          <div className="space-y-2.5 pt-1">
            <h4 className="font-heading text-sm font-bold text-[#0F172A]">
              ขั้นตอนการเดินไปยังปลายทาง
            </h4>
            <ol className="space-y-2.5">
              {steps.map((step) => (
                <li
                  key={`step-${step.stepNumber}`}
                  className="flex items-start gap-3"
                >
                  <span
                    className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                      step.isDestination
                        ? "bg-[#FFE4E6] text-[#BE123C] border border-rose-200"
                        : "bg-[#CCFBF1] text-[#047857] border border-teal-200"
                    }`}
                  >
                    {step.stepNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#0F172A] leading-snug">
                      {step.title}
                    </p>
                    <p className="text-[13px] text-slate-600 mt-0.5 leading-relaxed">
                      {step.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Indoor Guide Highlight Box */}
          {routeData.target_building.indoor_guide && (
            <div className="rounded-xl bg-teal-50/80 border border-teal-200 p-3.5 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#0F766E] text-white flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F766E]">
                  <Info className="w-3.5 h-3.5" />
                  <span>คำแนะนำการเดินภายในอาคาร</span>
                </div>
                <p className="text-sm text-slate-800 mt-1 leading-relaxed whitespace-pre-line">
                  {routeData.target_building.indoor_guide}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
