"use client";

import {
  Accessibility,
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Clock,
  Info,
  Loader2,
  MapPin,
  Navigation,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Umbrella,
  X,
} from "lucide-react";
import type { Category, MapNode, RouteResponse } from "@/lib/api";
import { buildTurnByTurnSteps, classifyBuilding } from "@/lib/hospital";

interface RoutePanelProps {
  buildings: MapNode[];
  categories?: Category[];
  originLabel: string;
  originMode: "gps" | "building";
  originBuildingId: number | null;
  qrOriginNode?: MapNode | null;
  targetBuilding: MapNode | null;
  routeData: RouteResponse | null;
  isLoadingRoute: boolean;
  routeError: string | null;
  isNavigating?: boolean;
  onChangeOriginMode: (mode: "gps" | "building", buildingId?: number) => void;
  onSwapOriginAndTarget: () => void;
  onPickTargetTab: () => void;
  onRetryRoute: () => void;
  onStartNavigation?: () => void;
  onEndNavigation?: () => void;
  compactHeaderOnly?: boolean;
}

export default function RoutePanel({
  buildings,
  categories,
  originLabel,
  originMode,
  originBuildingId,
  qrOriginNode = null,
  targetBuilding,
  routeData,
  isLoadingRoute,
  routeError,
  isNavigating = false,
  onChangeOriginMode,
  onSwapOriginAndTarget,
  onPickTargetTab,
  onRetryRoute,
  onStartNavigation,
  onEndNavigation,
  compactHeaderOnly = false,
}: RoutePanelProps) {
  const showQrNodeOption =
    qrOriginNode && !buildings.some((b) => b.id === qrOriginNode.id);

  const originDestinationCard = (
    <div className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Origin row */}
          <div className="flex items-center gap-2.5">
            {qrOriginNode &&
            originMode === "building" &&
            originBuildingId === qrOriginNode.id ? (
              <QrCode className="w-4 h-4 text-[#0F766E] shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 rounded-full border-[3px] border-[#0F766E] bg-white shrink-0" />
            )}
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
                <option value="gps">
                  จาก: {originMode === "gps" ? originLabel : "ตำแหน่งปัจจุบัน (GPS)"}
                </option>
                {showQrNodeOption && qrOriginNode && (
                  <option value={String(qrOriginNode.id)}>
                    จาก (QR): {qrOriginNode.name || `จุด #${qrOriginNode.id}`}
                  </option>
                )}
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
    ? classifyBuilding(routeData.target_building, categories)
    : targetBuilding
    ? classifyBuilding(targetBuilding, categories)
    : null;
  const roundedDist = routeData ? Math.round(routeData.total_distance_m) : 0;
  const roundedMin = routeData
    ? Math.max(1, Math.round(routeData.estimated_walk_min))
    : 0;

  const isWheelchairFriendly = routeData?.is_wheelchair_friendly !== false;
  const hasCoveredWalkway = Boolean(routeData?.has_covered_walkway);
  const hasIndoorPassthrough = Boolean(routeData?.has_indoor_passthrough);

  const uniqueClosureReasons = Array.from(
    new Set(
      (routeData?.closed_notices ?? [])
        .map((n) => (n.closure_reason || "").trim())
        .filter((r) => r.length > 0)
    )
  );

  const edgeHighlights = (routeData?.route_edges ?? []).filter(
    (e) => (e.instruction || "").trim().length > 0
  );

  const targetDepts =
    routeData?.target_building?.departments ??
    targetBuilding?.departments ??
    [];

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
                  className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border"
                  style={{
                    color: targetBadge.badgeStyle.text,
                    backgroundColor: targetBadge.badgeStyle.bg,
                    borderColor: targetBadge.badgeStyle.border,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: targetBadge.accentColor }}
                  />
                  <span>{targetBadge.badgeLabel}</span>
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

          {/* Real Edge Feature Badges from map_edges */}
          <div className="flex flex-wrap gap-2">
            {isWheelchairFriendly ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#DBEAFE] text-[#1D4ED8] text-xs font-semibold">
                <Accessibility className="w-3.5 h-3.5" />
                <span>รองรับทางลาดรถเข็น</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>มีช่วงที่อาจไม่เหมาะกับรถเข็น</span>
              </span>
            )}

            {hasCoveredWalkway && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 text-xs font-semibold">
                <Umbrella className="w-3.5 h-3.5" />
                <span>ทางเชื่อมมีหลังคา</span>
              </span>
            )}

            {hasIndoorPassthrough && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-800 text-xs font-semibold">
                <Building2 className="w-3.5 h-3.5" />
                <span>ทางเดินผ่านชั้นล่างตึก</span>
              </span>
            )}
          </div>

          {/* Closed Walkway Notice Banner (closure_reason from map_edges) */}
          {uniqueClosureReasons.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-bold text-amber-900">
                  แจ้งเตือนเส้นทางปิดปรับปรุง (ระบบเลี่ยงเส้นทางให้อัตโนมัติ)
                </p>
                <ul className="space-y-0.5 text-xs text-amber-800 list-disc pl-4">
                  {uniqueClosureReasons.map((reason, idx) => (
                    <li key={`closure-${idx}`}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Primary Start / End Active Navigation CTA */}
          {onStartNavigation && (
            <div>
              {isNavigating ? (
                <button
                  type="button"
                  onClick={onEndNavigation}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-[#BE123C] hover:bg-rose-800 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span>สิ้นสุดการนำทาง</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartNavigation}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <Navigation className="w-4 h-4" />
                  <span>เริ่มนำทาง</span>
                </button>
              )}
            </div>
          )}

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

          {/* Specific Walkway Notes from traversed edges */}
          {edgeHighlights.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
              <p className="text-xs font-bold text-slate-700">
                หมายเหตุจุดสำคัญระหว่างทาง
              </p>
              <ul className="space-y-1.5">
                {edgeHighlights.map((edge) => (
                  <li
                    key={`edge-note-${edge.id}`}
                    className="text-xs text-slate-600 flex items-start justify-between gap-2"
                  >
                    <span>{edge.instruction}</span>
                    <span className="shrink-0 flex items-center gap-1">
                      {edge.is_covered && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-bold">
                          มีหลังคา
                        </span>
                      )}
                      {edge.is_indoor_passthrough && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">
                          ผ่านชั้นล่างตึก
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Structured Departments inside Target Building */}
          {targetDepts.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                <Building2 className="w-3.5 h-3.5 text-[#0F766E]" />
                <span>แผนกและคลินิกภายในอาคารนี้ ({targetDepts.length})</span>
              </div>
              <div className="space-y-1.5">
                {targetDepts.map((dept) => (
                  <div
                    key={`route-dept-${dept.id}`}
                    className="rounded-lg bg-white border border-slate-100 px-2.5 py-1.5 flex items-start justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">
                        {dept.name}
                      </p>
                      {dept.operating_hours && (
                        <p className="text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>{dept.operating_hours}</span>
                        </p>
                      )}
                    </div>
                    {dept.floor && (
                      <span className="shrink-0 px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-[11px] font-bold text-[#0F766E]">
                        {dept.floor}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
