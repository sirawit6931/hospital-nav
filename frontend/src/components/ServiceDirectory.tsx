"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Accessibility,
  Building2,
  Car,
  Compass,
  Headphones,
  Hospital,
  Info,
  Loader2,
  Lock,
  Navigation,
  Phone,
  Pill,
  RefreshCw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { MapNode, ServicePoint } from "@/lib/api";

interface ServiceDirectoryProps {
  servicePoints: ServicePoint[];
  buildings: MapNode[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onNavigateToNode: (nodeId: number) => void;
}

interface ServiceTypeMeta {
  label: string;
  order: number;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  cardBg: string;
  cardBorder: string;
}

const SERVICE_TYPE_META: Record<string, ServiceTypeMeta> = {
  emergency: {
    label: "เหตุฉุกเฉินและสายด่วน",
    order: 1,
    icon: ShieldAlert,
    iconBg: "bg-[#FFE4E6]",
    iconColor: "text-[#BE123C]",
    cardBg: "bg-[#FFE4E6]/50",
    cardBorder: "border-rose-200",
  },
  info: {
    label: "ประชาสัมพันธ์และสอบถามข้อมูล",
    order: 2,
    icon: Headphones,
    iconBg: "bg-teal-50",
    iconColor: "text-[#0F766E]",
    cardBg: "bg-slate-50",
    cardBorder: "border-slate-200",
  },
  opd: {
    label: "จุดคัดกรองและผู้ป่วยนอก (OPD)",
    order: 3,
    icon: Hospital,
    iconBg: "bg-[#DBEAFE]",
    iconColor: "text-[#1D4ED8]",
    cardBg: "bg-slate-50",
    cardBorder: "border-slate-200",
  },
  wheelchair: {
    label: "บริการรถเข็นและผู้สูงอายุ",
    order: 4,
    icon: Accessibility,
    iconBg: "bg-[#CCFBF1]",
    iconColor: "text-[#047857]",
    cardBg: "bg-slate-50",
    cardBorder: "border-slate-200",
  },
  pharmacy: {
    label: "ห้องยาและการเงิน",
    order: 5,
    icon: Pill,
    iconBg: "bg-indigo-50",
    iconColor: "text-indigo-700",
    cardBg: "bg-slate-50",
    cardBorder: "border-slate-200",
  },
  parking: {
    label: "ลานจอดรถและจุดรับ-ส่ง",
    order: 6,
    icon: Car,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-700",
    cardBg: "bg-slate-50",
    cardBorder: "border-slate-200",
  },
  other: {
    label: "จุดอำนวยความสะดวกอื่น ๆ",
    order: 99,
    icon: Info,
    iconBg: "bg-slate-100",
    iconColor: "text-slate-700",
    cardBg: "bg-slate-50",
    cardBorder: "border-slate-200",
  },
};

function getServiceTypeMeta(typeKey: string): ServiceTypeMeta {
  const key = (typeKey || "other").toLowerCase().trim();
  return (
    SERVICE_TYPE_META[key] || {
      ...SERVICE_TYPE_META.other,
      label: typeKey || SERVICE_TYPE_META.other.label,
    }
  );
}

function sanitizeTelHref(phone: string): string {
  return phone.replace(/[^0-9+*#]/g, "");
}

export default function ServiceDirectory({
  servicePoints,
  buildings,
  isLoading = false,
  error = null,
  onRetry,
  onNavigateToNode,
}: ServiceDirectoryProps) {
  const buildingNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of buildings) {
      map.set(b.id, b.name);
    }
    return map;
  }, [buildings]);

  const groupedServices = useMemo(() => {
    const active = servicePoints.filter((s) => s.is_active !== false);
    const groups = new Map<string, ServicePoint[]>();
    for (const item of active) {
      const key = (item.type || "other").toLowerCase().trim() || "other";
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }

    return Array.from(groups.entries())
      .map(([typeKey, items]) => ({
        typeKey,
        meta: getServiceTypeMeta(typeKey),
        items,
      }))
      .sort((a, b) => a.meta.order - b.meta.order);
  }, [servicePoints]);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 flex flex-col items-center justify-center gap-2 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-[#0F766E]" />
          <span className="text-sm">กำลังโหลดข้อมูลจุดบริการ...</span>
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-[#BE123C] shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[#BE123C]">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="min-h-[40px] px-3.5 rounded-lg bg-white border border-rose-200 text-xs font-bold text-[#BE123C] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>ลองโหลดใหม่</span>
              </button>
            )}
          </div>
        </div>
      ) : groupedServices.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-1.5">
          <p className="font-heading text-sm font-bold text-slate-800">
            ยังไม่มีข้อมูลจุดบริการในระบบ
          </p>
          <p className="text-xs text-slate-500">
            เจ้าหน้าที่สามารถเพิ่มจุดบริการและหมายเลขโทรศัพท์ได้จากระบบหลังบ้าน
          </p>
        </div>
      ) : (
        groupedServices.map(({ typeKey, meta, items }) => {
          const GroupIcon = meta.icon;
          const isEmergency = typeKey === "emergency";

          return (
            <section
              key={typeKey}
              className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.iconBg} ${meta.iconColor}`}
                >
                  <GroupIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-heading text-sm sm:text-[15px] font-bold text-[#0F172A] leading-snug">
                    {meta.label}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {items.length} จุดบริการ
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {items.map((sp) => {
                  const linkedBuildingName = sp.node_id
                    ? buildingNameById.get(sp.node_id)
                    : null;
                  const telHref = sp.phone ? sanitizeTelHref(sp.phone) : "";

                  return (
                    <div
                      key={sp.id}
                      className={`rounded-xl border p-3.5 space-y-2.5 ${meta.cardBg} ${meta.cardBorder}`}
                    >
                      <div className="space-y-1">
                        <p
                          className={`text-sm font-bold leading-snug ${
                            isEmergency ? "text-[#BE123C]" : "text-[#0F172A]"
                          }`}
                        >
                          {sp.name}
                        </p>
                        {sp.description && (
                          <p
                            className={`text-xs leading-relaxed ${
                              isEmergency
                                ? "text-rose-900/85"
                                : "text-slate-600"
                            }`}
                          >
                            {sp.description}
                          </p>
                        )}
                        {linkedBuildingName && (
                          <p className="text-[11.5px] font-semibold text-[#0F766E] inline-flex items-center gap-1 pt-0.5">
                            <Building2 className="w-3.5 h-3.5 shrink-0" />
                            <span>ตำแหน่ง: {linkedBuildingName}</span>
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {sp.node_id !== null && sp.node_id > 0 && (
                          <button
                            type="button"
                            onClick={() => onNavigateToNode(sp.node_id!)}
                            className="min-h-[40px] px-3.5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>ดูเส้นทาง / นำทาง</span>
                          </button>
                        )}

                        {telHref && (
                          <a
                            href={`tel:${telHref}`}
                            className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
                              isEmergency
                                ? "bg-[#BE123C] border-[#BE123C] text-white hover:bg-rose-800"
                                : "bg-white border-slate-200 text-slate-700 hover:border-teal-300 hover:text-[#0F766E]"
                            }`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>โทร {sp.phone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
        <h3 className="font-heading text-sm font-bold text-[#0F172A] flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-600" />
          <span>สำหรับเจ้าหน้าที่ดูแลระบบแผนที่</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Link
            href="/admin/login"
            className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-teal-50 hover:border-teal-200 text-sm font-semibold text-slate-800 flex items-center justify-center gap-2 transition-colors"
          >
            <Lock className="w-4 h-4 text-[#0F766E]" />
            <span>จัดการแผนที่ (Admin)</span>
          </Link>
          <Link
            href="/admin/survey"
            className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-teal-50 hover:border-teal-200 text-sm font-semibold text-slate-800 flex items-center justify-center gap-2 transition-colors"
          >
            <Compass className="w-4 h-4 text-[#0F766E]" />
            <span>เก็บพิกัดภาคสนาม</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
