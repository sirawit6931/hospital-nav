"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Footprints,
  Image as ImageIcon,
  Info,
  MapPin,
  Navigation,
  SearchCheck,
  Stethoscope,
  X,
} from "lucide-react";
import {
  getBuildingImages,
  type Category,
  type Department,
  type MapNode,
} from "@/lib/api";
import {
  calculateDistanceMeters,
  classifyBuilding,
  extractDepartmentItems,
  formatDistanceAndTime,
} from "@/lib/hospital";
import { findMatchingDepartments } from "@/lib/search";

interface BuildingCardProps {
  building: MapNode;
  categories?: Category[];
  originCoords: [number, number];
  isSelected: boolean;
  searchQuery?: string;
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
  if (up.startsWith("B")) return -1;
  if (up.startsWith("G")) return 0;
  const m = up.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

function groupDepartmentsByFloor(depts: Department[]) {
  const map = new Map<string, Department[]>();
  for (const d of depts) {
    const key = shortFloorLabel(d.floor);
    const list = map.get(key) ?? [];
    list.push(d);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => floorSortOrder(a[0]) - floorSortOrder(b[0]))
    .map(([floor, items]) => ({
      floor,
      items,
      summary: items.map((d) => d.name).join(", "),
    }));
}

export default function BuildingCard({
  building,
  categories,
  originCoords,
  isSelected,
  searchQuery = "",
  onSelectRoute,
  onFocusOnMap,
}: BuildingCardProps) {
  const [showAllFloors, setShowAllFloors] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  const badge = classifyBuilding(building, categories);
  const images = useMemo(() => getBuildingImages(building), [building]);
  const structuredDepts = building.departments ?? [];
  const floorGroups = useMemo(
    () => groupDepartmentsByFloor(structuredDepts),
    [structuredDepts]
  );
  const matchedDepts = useMemo(
    () => (searchQuery.trim() ? findMatchingDepartments(building, searchQuery) : []),
    [building, searchQuery]
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

  const openGalleryAt = (idx = 0) => {
    setGalleryIdx(Math.max(0, Math.min(idx, Math.max(0, images.length - 1))));
    setDetailModalOpen(true);
  };

  return (
    <>
      <article
        className={`rounded-2xl bg-white border transition-all p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
          isSelected
            ? "border-[#0F766E] ring-2 ring-teal-600/15"
            : "border-slate-200 hover:border-teal-300"
        }`}
      >
        {/* Highlighted Room/Department Search Match Banner */}
        {matchedDepts.length > 0 && (
          <div className="mb-3 rounded-xl bg-[#CCFBF1]/70 border border-teal-300 px-3 py-2 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#0F766E]">
              <SearchCheck className="w-3.5 h-3.5 shrink-0" />
              <span>พบห้อง/แผนกที่ค้นหาในอาคารนี้</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {matchedDepts.slice(0, 3).map((d) => (
                <span
                  key={`hit-${d.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-teal-200 text-xs font-bold text-[#0F172A]"
                >
                  {d.floor && (
                    <span className="text-[#0F766E]">{d.floor} •</span>
                  )}
                  <span>{d.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}

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

        {/* Multi-Photo Preview Strip (when building has 1 or more photos) */}
        {images.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <button
              type="button"
              onClick={() => openGalleryAt(0)}
              className="relative w-full h-32 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 group cursor-pointer block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images[0]}
                alt={building.name}
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              />
              <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-slate-900/75 text-white text-[11px] font-bold inline-flex items-center gap-1 backdrop-blur-xs">
                <ImageIcon className="w-3 h-3" />
                <span>
                  {images.length > 1
                    ? `ดูทั้งหมด ${images.length} รูป`
                    : "ดูรูปและรายละเอียด"}
                </span>
              </span>
            </button>

            {images.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {images.slice(0, 5).map((imgUrl, idx) => (
                  <button
                    key={`${building.id}-thumb-${idx}`}
                    type="button"
                    onClick={() => openGalleryAt(idx)}
                    className="relative w-14 h-10 rounded-lg overflow-hidden border border-slate-200 hover:border-[#0F766E] shrink-0 cursor-pointer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgUrl}
                      alt={`รูปที่ ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {idx === 4 && images.length > 5 && (
                      <span className="absolute inset-0 bg-slate-900/65 text-white text-[11px] font-bold flex items-center justify-center">
                        +{images.length - 5}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compact Floor-by-Floor 2-Column Summary Grid */}
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

        <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-700">
            <Footprints className="w-4 h-4 text-[#047857]" />
            <span>{combinedLabel}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openGalleryAt(0)}
              className="min-h-[42px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 text-[#0F766E]" />
              <span>รายละเอียด</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectRoute(building)}
              className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] active:bg-[#134E4A] text-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
            >
              <Navigation className="w-4 h-4" />
              <span>ดูเส้นทาง</span>
            </button>
          </div>
        </div>
      </article>

      {/* ================= BUILDING DETAIL & MULTI-PHOTO GALLERY MODAL ================= */}
      {detailModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[1200] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setDetailModalOpen(false)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[90dvh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="px-2 py-0.5 rounded-md text-[11px] font-bold border"
                    style={{
                      color: badge.badgeStyle.text,
                      backgroundColor: badge.badgeStyle.bg,
                      borderColor: badge.badgeStyle.border,
                    }}
                  >
                    {badgeDisplayText}
                  </span>
                  {statusBadge && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${statusBadge.cls}`}
                    >
                      {statusBadge.label}
                    </span>
                  )}
                </div>
                <h2 className="font-heading text-lg font-bold text-[#0F172A] mt-1 leading-snug">
                  {building.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                aria-label="ปิดรายละเอียดอาคาร"
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Interactive Multi-Photo Gallery */}
              {images.length > 0 ? (
                <div className="space-y-2">
                  <div className="relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 aspect-[16/10] w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={images[galleryIdx] || images[0]}
                      alt={`${building.name} รูปที่ ${galleryIdx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-slate-900/75 text-white text-xs font-bold">
                      {galleryIdx + 1} / {images.length}
                    </span>

                    {images.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setGalleryIdx((prev) =>
                              prev === 0 ? images.length - 1 : prev - 1
                            )
                          }
                          aria-label="รูปก่อนหน้า"
                          className="w-9 h-9 rounded-full bg-white/90 hover:bg-white text-slate-800 shadow-md absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setGalleryIdx((prev) =>
                              prev === images.length - 1 ? 0 : prev + 1
                            )
                          }
                          aria-label="รูปถัดไป"
                          className="w-9 h-9 rounded-full bg-white/90 hover:bg-white text-slate-800 shadow-md absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </>
                    )}
                  </div>

                  {images.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {images.map((url, idx) => (
                        <button
                          key={`modal-img-${idx}`}
                          type="button"
                          onClick={() => setGalleryIdx(idx)}
                          className={`w-16 h-12 rounded-xl overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                            idx === galleryIdx
                              ? "border-[#0F766E] ring-2 ring-teal-500/20"
                              : "border-slate-200 opacity-70 hover:opacity-100"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`ตัวอย่าง ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 flex items-center gap-3 text-slate-500">
                  <Building2 className="w-6 h-6 text-slate-400 shrink-0" />
                  <p className="text-xs">ยังไม่มีรูปภาพสำหรับอาคารนี้</p>
                </div>
              )}

              {/* Floor-by-Floor Rooms & Departments */}
              {floorGroups.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="font-heading text-sm font-bold text-[#0F172A] flex items-center gap-1.5">
                    <Stethoscope className="w-4 h-4 text-[#0F766E]" />
                    <span>แผนกและห้องแยกตามชั้น</span>
                  </h3>
                  <div className="space-y-2">
                    {floorGroups.map((fg) => (
                      <div
                        key={`modal-fl-${fg.floor}`}
                        className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-1.5"
                      >
                        <span className="inline-block px-2 py-0.5 rounded-md bg-[#0F766E] text-white text-[11px] font-bold">
                          ชั้น {fg.floor}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {fg.items.map((dept) => (
                            <span
                              key={`modal-dept-${dept.id}`}
                              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-800"
                            >
                              {dept.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Indoor Guide */}
              {building.indoor_guide && (
                <div className="rounded-xl bg-teal-50/80 border border-teal-200 p-3.5 space-y-1">
                  <p className="text-xs font-bold text-[#0F766E]">
                    คำแนะนำภายในอาคาร
                  </p>
                  <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {building.indoor_guide}
                  </p>
                </div>
              )}
            </div>

            {/* Footer CTA */}
            <div className="px-5 py-3.5 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-white">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                <Footprints className="w-4 h-4 text-[#047857]" />
                <span>{combinedLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailModalOpen(false);
                  onSelectRoute(building);
                }}
                className="min-h-[44px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <Navigation className="w-4 h-4" />
                <span>ดูเส้นทาง / นำทาง</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
