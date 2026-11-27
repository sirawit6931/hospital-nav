"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  Megaphone,
  X,
} from "lucide-react";
import type { Announcement } from "@/lib/api";

interface AnnouncementBannerProps {
  announcements: Announcement[];
  compact?: boolean;
}

function isAnnouncementActiveNow(item: Announcement): boolean {
  if (!item.is_active) return false;
  if (!item.expires_at) return true;
  const expMs = Date.parse(item.expires_at);
  if (Number.isNaN(expMs)) return true;
  return expMs > Date.now();
}

export default function AnnouncementBanner({
  announcements,
  compact = false,
}: AnnouncementBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [currentIdx, setCurrentIdx] = useState(0);

  const visible = announcements.filter(
    (a) => isAnnouncementActiveNow(a) && !dismissedIds.has(a.id)
  );

  if (visible.length === 0) return null;

  const safeIdx = currentIdx % visible.length;
  const active = visible[safeIdx];
  const level = (active.level || "info").toLowerCase();

  const palette =
    level === "urgent" || level === "danger" || level === "error"
      ? {
          wrap: "bg-[#FFE4E6] border-rose-200 text-[#9F1239]",
          iconBg: "bg-[#BE123C] text-white",
          badge: "bg-white/80 text-[#BE123C] border-rose-200",
          btn: "hover:bg-rose-200/70 text-[#9F1239]",
          Icon: AlertTriangle,
        }
      : level === "warning"
      ? {
          wrap: "bg-amber-50 border-amber-200 text-amber-950",
          iconBg: "bg-amber-500 text-white",
          badge: "bg-white/80 text-amber-800 border-amber-200",
          btn: "hover:bg-amber-200/60 text-amber-900",
          Icon: Megaphone,
        }
      : {
          wrap: "bg-teal-50 border-teal-200 text-[#0F172A]",
          iconBg: "bg-[#0F766E] text-white",
          badge: "bg-white/80 text-[#0F766E] border-teal-200",
          btn: "hover:bg-teal-200/60 text-[#0F766E]",
          Icon: Info,
        };

  const LevelIcon = palette.Icon;

  const handleDismiss = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(active.id);
      return next;
    });
    setCurrentIdx(0);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`shrink-0 border-b ${palette.wrap} ${
        compact ? "px-3 py-2" : "px-4 py-2.5"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 shadow-xs ${palette.iconBg}`}
        >
          <LevelIcon className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-heading text-xs sm:text-[13px] font-bold leading-snug">
              {active.title}
            </p>
            {visible.length > 1 && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${palette.badge}`}
              >
                {safeIdx + 1}/{visible.length}
              </span>
            )}
          </div>
          {active.message && (
            <p className="text-xs opacity-90 leading-relaxed mt-0.5">
              {active.message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {visible.length > 1 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setCurrentIdx(
                    (prev) => (prev - 1 + visible.length) % visible.length
                  )
                }
                aria-label="ประกาศก่อนหน้า"
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${palette.btn}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentIdx((prev) => (prev + 1) % visible.length)
                }
                aria-label="ประกาศถัดไป"
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${palette.btn}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="ปิดประกาศนี้ชั่วคราว"
            title="ปิดประกาศนี้ชั่วคราว"
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${palette.btn}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
