"use client";

import { Footprints, MapPin, Navigation } from "lucide-react";
import type { MapNode } from "@/lib/api";
import {
  calculateDistanceMeters,
  classifyBuilding,
  extractDepartmentItems,
  formatDistanceAndTime,
} from "@/lib/hospital";

interface BuildingCardProps {
  building: MapNode;
  originCoords: [number, number];
  isSelected: boolean;
  onSelectRoute: (building: MapNode) => void;
  onFocusOnMap?: (building: MapNode) => void;
}

export default function BuildingCard({
  building,
  originCoords,
  isSelected,
  onSelectRoute,
  onFocusOnMap,
}: BuildingCardProps) {
  const badge = classifyBuilding(building);
  const departments = extractDepartmentItems(building);
  const approxDistance = calculateDistanceMeters(
    originCoords[0],
    originCoords[1],
    building.lat,
    building.lng
  );
  const { combinedLabel } = formatDistanceAndTime(approxDistance);

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
          <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">
            {badge.subtitle}
          </p>
        </button>

        <span
          className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border"
          style={{
            color: badge.badgeStyle.text,
            backgroundColor: badge.badgeStyle.bg,
            borderColor: badge.badgeStyle.border,
          }}
        >
          {badge.badgeLabel}
        </span>
      </div>

      {departments.length > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {departments.map((dept, idx) => (
              <div
                key={`${building.id}-dept-${idx}`}
                className="flex items-start gap-1.5 text-[13px] text-slate-700 leading-snug min-w-0"
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

      {building.indoor_guide && departments.length === 0 && (
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
          className="min-h-[44px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] active:bg-[#134E4A] text-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
        >
          <Navigation className="w-4 h-4" />
          <span>ดูเส้นทาง</span>
        </button>
      </div>
    </article>
  );
}
