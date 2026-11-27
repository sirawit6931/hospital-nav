"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Footprints,
  MapPin,
  Navigation,
} from "lucide-react";
import type { Category, Department, MapNode } from "@/lib/api";
import {
  calculateDistanceMeters,
  classifyBuilding,
  extractDepartmentItems,
  formatDistanceAndTime,
} from "@/lib/hospital";

interface BuildingCardProps {
  building: MapNode;
  categories?: Category[];
  originCoords: [number, number];
  isSelected: boolean;
  onSelectRoute: (building: MapNode) => void;
  onFocusOnMap?: (building: MapNode) => void;
}

const DEFAULT_VISIBLE_FLOORS = 4;

function shortFloorLabel(raw: string): string {
  const cleaned = (raw || "").replace(/^ชั้น\s*/i, "").trim();
  return cleaned || "ทั่วไป";
}

function floorSortOrder(label: string): number {
  const up = label.toUpperCase();
  if (up.startsWith("G") || up.startsWith("B")) return 0;
  const m = up.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

function groupDepartmentsByFloor(depts: Department[]) {
  const map = new Map<string, string[]>();
  for (const d of depts) {
    const key = shortFloorLabel(d.floor);
    const list = map.get(key) ?? [];
    list.push(d.name);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => floorSortOrder(a[0]) - floorSortOrder(b[0]))
    .map(([floor, names]) => ({
      floor,
      summary: names.join(", "),
    }));
}

export default function BuildingCard({
  building,
  categories,
  originCoords,
  isSelected,
  onSelectRoute,
  onFocusOnMap,
}: BuildingCardProps) {
  const [showAllFloors, setShowAllFloors] = useState(false);

  const badge = classifyBuilding(building, categories);
  const structuredDepts = building.departments ?? [];
  const floorGroups = useMemo(
    () => groupDepartmentsByFloor(structuredDepts),
    [structuredDepts]
  );
  const fallbackKeywords =
    structuredDepts.length === 0 ? extractDepartmentItems(building) : [];

  const approxDistance = calculateDistanceMeters(
    originCoords[0],
    originCoords[1],
    building.lat,
    building.lng
  );
  const { combinedLabel } = formatDistanceAndTime(approxDistance);

  const visibleFloorGroups = showAllFloors
    ? floorGroups
    : floorGroups.slice(0, DEFAULT_VISIBLE_FLOORS);
  const hiddenFloorCount = Math.max(
    0,
    floorGroups.length - DEFAULT_VISIBLE_FLOORS
  );

  const badgeDisplayText =
    (building.badge_label || "").trim() || badge.badgeLabel;

  const serviceStatus = building.service_status || "open";
  const statusBadge =
    serviceStatus === "open_24h"
      ? {
          label: "เปิดบริการ 24 ชั่วโมง",
          cls: "text-[#BE123C] bg-rose-50 border-rose-200",
        }
      : serviceStatus === "maintenance"
      ? {
          label: "ปิดปรับปรุง",
          cls: "text-amber-800 bg-amber-50 border-amber-200",
        }
      : null;

  return (
    <article
      className={`rounded-2xl bg-white border transition-all p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        isSelected
          ? "border-[#0F766E] ring-2 ring-teal-600/15"
          : "border-slate-200 hover:border-teal-300"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onFocusOnMap?.(building)}
          className="text-left min-w-0 flex-1 cursor-pointer group"
        >
          <h3 className="font-heading text-[16px] font-bold text-[#0F172A] leading-snug group-hover:text-[#0F766E] transition-colors">
            {building.name || `อาคาร #${building.id}`}
          </h3>
          <div className="mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-1">
            <p className="text-[12.5px] text-slate-500 leading-snug">
              {badge.subtitle}
            </p>
            {statusBadge && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${statusBadge.cls}`}
              >
                <Clock className="w-2.5 h-2.5 shrink-0" />
                <span>{statusBadge.label}</span>
              </span>
            )}
          </div>
        </button>

        <span
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border max-w-[140px]"
          style={{
            color: badge.badgeStyle.text,
            backgroundColor: badge.badgeStyle.bg,
            borderColor: badge.badgeStyle.border,
          }}
          title={badgeDisplayText}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: badge.accentColor }}
          />
          <span className="truncate">{badgeDisplayText}</span>
        </span>
      </div>

      {/* Compact Floor-by-Floor 2-Column Summary Grid (matches Image 1 design) */}
      {floorGroups.length > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
            {visibleFloorGroups.map((fg) => (
              <div
                key={`${building.id}-fl-${fg.floor}`}
                className="text-[12.5px] leading-snug text-slate-700 min-w-0 truncate"
                title={`${fg.floor}: ${fg.summary}`}
              >
                <span className="font-bold text-[#0F172A] mr-1">
                  {fg.floor}:
                </span>
                <span>{fg.summary}</span>
              </div>
            ))}
          </div>

          {hiddenFloorCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllFloors((prev) => !prev)}
              className="w-full pt-1 border-t border-slate-200/70 text-xs font-bold text-[#0F766E] hover:text-[#115E59] inline-flex items-center justify-center gap-1 cursor-pointer"
            >
              {showAllFloors ? (
                <>
                  <span>ย่อรายการชั้น</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>ดูเพิ่มเติมอีก {hiddenFloorCount} ชั้น</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Fallback keywords grid when building has no structured departments yet */}
      {floorGroups.length === 0 && fallbackKeywords.length > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {fallbackKeywords.map((dept, idx) => (
              <div
                key={`${building.id}-kw-${idx}`}
                className="flex items-start gap-1.5 text-[12.5px] text-slate-700 leading-snug min-w-0"
              >
                <MapPin className="w-3.5 h-3.5 text-[#0F766E] shrink-0 mt-0.5" />
                <span className="truncate" title={dept}>
                  {dept}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {building.indoor_guide &&
        floorGroups.length === 0 &&
        fallbackKeywords.length === 0 && (
          <p className="mt-2.5 text-[13px] text-slate-600 line-clamp-2 leading-relaxed">
            {building.indoor_guide}
          </p>
        )}

      <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-700">
          <Footprints className="w-4 h-4 text-[#047857]" />
          <span>{combinedLabel}</span>
        </div>

        <button
          type="button"
          onClick={() => onSelectRoute(building)}
          className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] active:bg-[#134E4A] text-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
        >
          <Navigation className="w-4 h-4" />
          <span>ดูเส้นทาง</span>
        </button>
      </div>
    </article>
  );
}
