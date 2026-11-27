"use client";

import {
  Building2,
  CheckCircle2,
  Info,
  MapPin,
  Search,
  X,
} from "lucide-react";
import type { Category, MapNode } from "@/lib/api";
import { classifyBuilding } from "@/lib/hospital";

interface ArrivalModalProps {
  building: MapNode;
  categories?: Category[];
  distanceMeters: number;
  onClose: () => void;
  onSearchAnother: () => void;
}

export default function ArrivalModal({
  building,
  categories,
  distanceMeters,
  onClose,
  onSearchAnother,
}: ArrivalModalProps) {
  const badge = classifyBuilding(building, categories);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="arrival-modal-title"
      className="fixed inset-0 z-[1200] bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto">
        {/* Top Celebration Header (Clean Medical Emerald) */}
        <div className="relative bg-gradient-to-br from-[#0F766E] to-[#047857] text-white px-5 pt-6 pb-5 rounded-t-3xl">
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 text-white absolute top-3.5 right-3.5 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3.5 pr-10">
            <div className="w-13 h-13 rounded-2xl bg-white text-[#047857] flex items-center justify-center shrink-0 shadow-md">
              <CheckCircle2 className="w-8 h-8" strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-100">
                <MapPin className="w-3.5 h-3.5" />
                <span>อยู่ในระยะ {Math.max(0, Math.round(distanceMeters))} เมตร</span>
              </span>
              <h2
                id="arrival-modal-title"
                className="font-heading text-xl font-bold leading-tight mt-0.5"
              >
                ถึงจุดหมายแล้ว
              </h2>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Building Name & Type Badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-heading text-lg font-bold text-[#0F172A] leading-snug">
                {building.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{badge.subtitle}</p>
            </div>
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

          {/* Building Photo (image_url) */}
          {building.image_url ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={building.image_url}
                alt={`ภาพด้านหน้า ${building.name}`}
                className="w-full h-48 object-cover"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 flex items-center gap-3 text-slate-500">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-[#0F766E] flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <p className="text-xs leading-relaxed">
                คุณมาถึงบริเวณด้านหน้า <strong className="text-slate-700">{building.name}</strong> แล้ว กรุณาสังเกตป้ายทางเข้าอาคาร
              </p>
            </div>
          )}

          {/* Indoor Guide Box */}
          <div className="rounded-2xl bg-teal-50/85 border border-teal-200 p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0F766E]">
              <Info className="w-4 h-4 shrink-0" />
              <span>คำแนะนำการเดินภายในอาคาร</span>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
              {building.indoor_guide
                ? building.indoor_guide
                : "สามารถสอบถามจุดประชาสัมพันธ์หรือเจ้าหน้าที่บริเวณโถงชั้น 1 เพื่อไปยังห้องตรวจหรือหอผู้ป่วยที่ต้องการ"}
            </p>
          </div>

          {/* Touch-friendly Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>รับทราบ</span>
            </button>
            <button
              type="button"
              onClick={onSearchAnother}
              className="min-h-[48px] px-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4 text-[#0F766E]" />
              <span>ค้นหาอาคารอื่น</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
