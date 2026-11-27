"use client";

import {
  ArrowUp,
  CheckCircle2,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Loader2,
  LocateFixed,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  ActiveNavigationProgress,
  NavDirectionKind,
} from "@/lib/navigation";

interface ActiveNavigationOverlayProps {
  targetName: string;
  navProgress: ActiveNavigationProgress;
  isAutoRerouting: boolean;
  followUser: boolean;
  voiceEnabled: boolean;
  isSimulatingWalk: boolean;
  onRecenter: () => void;
  onToggleVoice: () => void;
  onToggleSimulateWalk: () => void;
  onEndNavigation: () => void;
}

function DirectionIcon({
  kind,
  className = "w-7 h-7",
}: {
  kind: NavDirectionKind;
  className?: string;
}) {
  switch (kind) {
    case "left":
      return <CornerUpLeft className={className} strokeWidth={2.5} />;
    case "right":
      return <CornerUpRight className={className} strokeWidth={2.5} />;
    case "arrive":
      return <Flag className={className} strokeWidth={2.4} />;
    default:
      return <ArrowUp className={className} strokeWidth={2.5} />;
  }
}

export default function ActiveNavigationOverlay({
  targetName,
  navProgress,
  isAutoRerouting,
  followUser,
  voiceEnabled,
  isSimulatingWalk,
  onRecenter,
  onToggleVoice,
  onToggleSimulateWalk,
  onEndNavigation,
}: ActiveNavigationOverlayProps) {
  const {
    activeStep,
    nextStep,
    distanceToNextTurnM,
    remainingDistanceM,
    remainingMinutes,
    hasArrived,
  } = navProgress;

  // Show upcoming turn icon & instruction when approaching a turn (<= 20m) or show current step
  const showUpcomingTurn =
    !hasArrived &&
    nextStep &&
    nextStep.direction !== "arrive" &&
    distanceToNextTurnM <= 20;

  const bannerDirection: NavDirectionKind = hasArrived
    ? "arrive"
    : showUpcomingTurn && nextStep
    ? nextStep.direction
    : activeStep.direction;

  const bannerHeadline = hasArrived
    ? "ถึงจุดหมายแล้ว"
    : `อีก ${Math.max(1, distanceToNextTurnM)} ม.`;

  const bannerInstruction = hasArrived
    ? `ถึงบริเวณ ${targetName} เรียบร้อยแล้ว`
    : showUpcomingTurn && nextStep
    ? nextStep.instruction
    : activeStep.instruction;

  return (
    <>
      {/* 1. Top Google-Maps-Style Turn Banner */}
      <div className="absolute top-3 left-3 right-3 sm:left-14 sm:right-14 z-[430] flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg rounded-2xl bg-[#0F766E] text-white shadow-xl border border-teal-700/80 overflow-hidden">
          <div className="px-4 py-3.5 flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              {hasArrived ? (
                <CheckCircle2 className="w-7 h-7 text-emerald-200" />
              ) : (
                <DirectionIcon kind={bannerDirection} className="w-7 h-7 text-white" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading text-xl sm:text-2xl font-bold leading-tight tracking-tight">
                {bannerHeadline}
              </div>
              <p className="text-sm font-medium text-teal-50 leading-snug mt-0.5 line-clamp-2">
                {bannerInstruction}
              </p>
            </div>
          </div>

          {/* Secondary Sub-Bar: Auto-Rerouting OR Next Turn Preview */}
          {isAutoRerouting ? (
            <div className="bg-[#0B5C56] px-4 py-2 text-xs font-semibold text-teal-100 flex items-center gap-2 border-t border-white/10">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-300 shrink-0" />
              <span>ออกนอกเส้นทาง กำลังคำนวณเส้นทางใหม่...</span>
            </div>
          ) : (
            !hasArrived &&
            nextStep && (
              <div className="bg-[#0B5C56] px-4 py-1.5 text-xs font-semibold text-teal-100 flex items-center gap-2 border-t border-white/10">
                <span className="text-teal-200/90 shrink-0">ถัดไป:</span>
                <DirectionIcon
                  kind={nextStep.direction}
                  className="w-3.5 h-3.5 text-white shrink-0"
                />
                <span className="truncate">{nextStep.title}</span>
              </div>
            )
          )}
        </div>
      </div>

      {/* 2. Floating Recenter Pill (appears ONLY when user dragged/rotated the map away during navigation) */}
      {!followUser && (
        <div className="absolute bottom-24 left-3 sm:left-4 z-[430]">
          <button
            type="button"
            onClick={onRecenter}
            className="min-h-[42px] px-3.5 rounded-full bg-white/98 backdrop-blur border border-slate-200 shadow-lg hover:bg-teal-50 text-[#0F766E] text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
          >
            <LocateFixed className="w-4 h-4" />
            <span>ปรับกึ่งกลาง</span>
          </button>
        </div>
      )}

      {/* 3. Bottom Active Navigation Bar */}
      <div className="absolute bottom-3 left-3 right-3 z-[430] flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg rounded-2xl bg-white/98 backdrop-blur border border-slate-200 shadow-xl px-3.5 py-3 flex items-center justify-between gap-2.5">
          {/* Remaining ETA & Distance */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-lg sm:text-xl font-bold text-[#0F766E] leading-none">
                {hasArrived ? "ถึงแล้ว" : `${remainingMinutes} นาที`}
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-600 tabular-nums">
                {hasArrived
                  ? "0 ม."
                  : `${Math.max(0, Math.round(remainingDistanceM))} ม.`}
              </span>
            </div>
            <p className="text-xs text-slate-500 truncate mt-0.5 max-w-[140px] sm:max-w-[200px]">
              {targetName}
            </p>
          </div>

          {/* Action Buttons: Simulate Walk + Voice Toggle + Red End Button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleSimulateWalk}
              title={
                isSimulatingWalk
                  ? "หยุดจำลองการเดิน"
                  : "จำลองเดินตามเส้นทาง (1.4 ม./วินาที) เพื่อทดสอบ"
              }
              className={`min-h-[40px] px-2.5 sm:px-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                isSimulatingWalk
                  ? "bg-amber-500 border-amber-600 text-white hover:bg-amber-600"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-amber-50 hover:border-amber-300"
              }`}
            >
              {isSimulatingWalk ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline sm:inline">หยุด</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>จำลองเดิน</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleVoice}
              title={voiceEnabled ? "ปิดเสียงนำทาง" : "เปิดเสียงนำทางภาษาไทย"}
              aria-label={voiceEnabled ? "ปิดเสียงนำทาง" : "เปิดเสียงนำทาง"}
              className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                voiceEnabled
                  ? "bg-teal-50 border-teal-200 text-[#0F766E] hover:bg-teal-100"
                  : "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {voiceEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onEndNavigation}
              className="min-h-[40px] px-3.5 rounded-xl bg-[#BE123C] hover:bg-rose-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>สิ้นสุด</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
