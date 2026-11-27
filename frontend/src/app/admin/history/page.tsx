"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { api, extractApiError, type AuditLog } from "@/lib/api";

function getActionBadgeClass(actionType: string): string {
  switch (actionType) {
    case "status_change":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "category_create":
    case "category_update":
    case "category_delete":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "edge_create":
    case "edge_update":
    case "edge_delete":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "rollback":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-teal-50 text-[#0F766E] border-teal-200";
  }
}

function formatThaiTimestamp(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;

  const now = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const timeStr = dt.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (isSameDay(dt, now)) {
    return `วันนี้ • ${timeStr} น.`;
  }
  if (isSameDay(dt, yesterday)) {
    return `เมื่อวาน • ${timeStr} น.`;
  }
  const dateStr = dt.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
  return `${dateStr} • ${timeStr} น.`;
}

export default function AdminHistoryPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState<AuditLog | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  const [toast, setToast] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (searchText.trim()) params.q = searchText.trim();
      if (selectedDate) params.date = selectedDate;
      const res = await api.get<AuditLog[]>("/api/admin/audit-logs", {
        params,
      });
      setLogs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถโหลดประวัติการแก้ไขได้"));
    } finally {
      setIsLoading(false);
    }
  }, [searchText, selectedDate, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 220);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const handleConfirmRollback = async () => {
    if (!rollbackTarget) return;
    setIsRollingBack(true);
    try {
      await api.post(`/api/admin/audit-logs/${rollbackTarget.id}/rollback`);
      showToast("success", "ย้อนกลับค่าเดิมเรียบร้อยแล้ว");
      setRollbackTarget(null);
      await fetchLogs();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถย้อนกลับค่าเดิมได้"));
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div className="min-h-full bg-[#F8FAFC] pb-20 md:pb-8">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[900] max-w-sm rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-semibold ${
            toast.type === "success"
              ? "bg-white border-teal-200 text-[#0F766E]"
              : "bg-rose-50 border-rose-200 text-[#BE123C]"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-xl sm:text-2xl font-bold text-[#0F172A]">
              ประวัติการแก้ไข
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              ติดตามทุกการเปลี่ยนแปลงของข้อมูลตึก แผนก หมวดหมู่ และแผนที่ 3D
              พร้อมย้อนกลับค่าเดิมได้ทันที
            </p>
          </div>
          <button
            type="button"
            onClick={fetchLogs}
            disabled={isLoading}
            aria-label="รีเฟรชประวัติ"
            className="min-h-[40px] w-10 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center cursor-pointer"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Search & Date Filter Bar (matches Image 2 right) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-xs space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="ค้นหาชื่อตึก, ผู้แก้ไข หรือรายการ..."
              className="w-full min-h-[42px] pl-10 pr-9 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#0F766E] focus:bg-white"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                aria-label="เลือกวันที่"
                className="w-full min-h-[40px] pl-10 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-[#0F766E] focus:bg-white"
              />
            </div>
            {selectedDate && (
              <button
                type="button"
                onClick={() => setSelectedDate("")}
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                ล้างวันที่
              </button>
            )}
          </div>
        </div>

        {/* Audit Log Timeline Cards */}
        {isLoading ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-12 flex flex-col items-center justify-center gap-2 text-slate-500">
            <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
            <span className="text-sm font-medium">
              กำลังโหลดประวัติการแก้ไข...
            </span>
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-12 text-center space-y-2">
            <History className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="font-heading text-sm font-bold text-slate-700">
              ยังไม่มีประวัติการแก้ไขที่ตรงกับเงื่อนไข
            </p>
            <p className="text-xs text-slate-500">
              เมื่อมีการแก้ไขข้อมูลตึก แผนก หมวดหมู่ หรือแผนที่ 3D
              รายการจะถูกบันทึกไว้ที่นี่โดยอัตโนมัติ
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((item) => {
              const canRollback =
                !item.is_rolled_back && item.action_type !== "rollback";
              return (
                <article
                  key={item.id}
                  className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-2.5"
                >
                  {/* Top Row: Action Label + Timestamp */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${getActionBadgeClass(
                        item.action_type
                      )}`}
                    >
                      {item.action_label}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      {formatThaiTimestamp(item.created_at)}
                    </span>
                  </div>

                  {/* Target Row: Short Badge + Title */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.badge_text && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-bold text-slate-700">
                        {item.badge_text}
                      </span>
                    )}
                    <h2 className="font-heading text-[15px] font-bold text-[#0F172A]">
                      {item.target_title}
                    </h2>
                  </div>

                  {/* Change Summary */}
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {item.summary}
                  </p>

                  {/* Footer: Actor + Rollback Button */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{item.actor_name}</span>
                    </div>

                    {canRollback ? (
                      <button
                        type="button"
                        onClick={() => setRollbackTarget(item)}
                        className="min-h-[34px] px-3 rounded-xl bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-xs font-bold text-slate-700 hover:text-[#0F766E] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>ย้อนกลับค่าเดิม</span>
                      </button>
                    ) : item.is_rolled_back ? (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-[11px] font-semibold text-slate-500">
                        ย้อนกลับค่าเดิมแล้ว
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm Rollback Modal */}
      {rollbackTarget && (
        <div className="fixed inset-0 z-[850] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-[#0F172A]">
                  ยืนยันการย้อนกลับค่าเดิม
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  ต้องการย้อนกลับรายการ &ldquo;{rollbackTarget.action_label}
                  &rdquo; ของ{" "}
                  <strong className="text-slate-800">
                    {rollbackTarget.target_title}
                  </strong>{" "}
                  กลับไปยังสถานะก่อนหน้าใช่หรือไม่?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRollbackTarget(null)}
                className="min-h-[38px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isRollingBack}
                onClick={handleConfirmRollback}
                className="min-h-[38px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isRollingBack && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>ยืนยันย้อนกลับ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
