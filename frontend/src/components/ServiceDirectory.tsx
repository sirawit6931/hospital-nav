"use client";

import Link from "next/link";
import {
  Accessibility,
  ArrowRight,
  Clock,
  Compass,
  Hospital,
  Lock,
  Phone,
  ShieldAlert,
} from "lucide-react";

export default function ServiceDirectory() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#FFE4E6] text-[#BE123C] flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-heading text-base font-bold text-[#0F172A]">
              หมายเลขติดต่อฉุกเฉินและประชาสัมพันธ์
            </h2>
            <p className="text-xs text-slate-500">
              โรงพยาบาลสกลนคร • บริการข้อมูลผู้ป่วยและญาติ
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 pt-1">
          <a
            href="tel:1669"
            className="min-h-[48px] px-4 py-3 rounded-xl bg-[#FFE4E6]/70 border border-rose-200 hover:bg-[#FFE4E6] flex items-center justify-between gap-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-[#BE123C]" />
              <div>
                <p className="text-sm font-bold text-[#BE123C]">
                  สายด่วนเจ็บป่วยฉุกเฉิน 1669
                </p>
                <p className="text-xs text-rose-800/80">
                  ให้บริการตลอด 24 ชั่วโมง
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#BE123C]" />
          </a>

          <a
            href="tel:042176000"
            className="min-h-[48px] px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 hover:bg-teal-50 hover:border-teal-200 flex items-center justify-between gap-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-[#0F766E]" />
              <div>
                <p className="text-sm font-bold text-[#0F172A]">
                  ประชาสัมพันธ์ รพ.สกลนคร
                </p>
                <p className="text-xs text-slate-500">โทร. 042-176-000</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-[#0F766E]" />
          </a>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <h3 className="font-heading text-sm font-bold text-[#0F172A] flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#0F766E]" />
          <span>เวลาทำการและจุดอำนวยความสะดวก</span>
        </h3>

        <div className="space-y-2.5 text-sm">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-start gap-2.5">
            <Hospital className="w-4 h-4 text-[#1D4ED8] shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-[#0F172A]">
                ห้องตรวจผู้ป่วยนอก (OPD)
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                วันจันทร์ – ศุกร์ เวลา 08:30 – 16:30 น. (ยื่นบัตรตั้งแต่ 06:30 น.)
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-start gap-2.5">
            <Accessibility className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-[#0F172A]">
                จุดบริการรถเข็นและผู้สูงอายุ
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                สามารถติดต่อขอรับบริการรถเข็นได้ที่จุดคัดกรองหน้าอาคารผู้ป่วยนอกและตึกอุบัติเหตุฉุกเฉิน
              </p>
            </div>
          </div>
        </div>
      </div>

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
