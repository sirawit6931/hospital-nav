"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  CheckCircle2,
  Copy,
  DatabaseBackup,
  Download,
  Loader2,
  Megaphone,
  Palette,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  extractApiError,
  type Announcement,
  type Category,
  type MapNode,
} from "@/lib/api";

type SettingsTab = "categories" | "announcements" | "qrcode" | "backup";

interface CategoryForm {
  id: number | null;
  name: string;
  slug: string;
  color_hex: string;
  badge_bg: string;
  sort_order: number;
  show_in_legend: boolean;
}

interface AnnouncementForm {
  id: number | null;
  title: string;
  message: string;
  level: string;
  is_active: boolean;
  expires_at: string;
}

const LEVEL_STYLES: Record<string, { label: string; cls: string }> = {
  info: { label: "ข้อมูลทั่วไป", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  warning: {
    label: "แจ้งเตือน / ปรับปรุง",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
  },
  urgent: {
    label: "ประกาศด่วน",
    cls: "bg-rose-50 text-[#BE123C] border-rose-200",
  },
};

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("announcements");
  const [categories, setCategories] = useState<Category[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [catModal, setCatModal] = useState<CategoryForm | null>(null);
  const [annModal, setAnnModal] = useState<AnnouncementForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "category" | "announcement";
    id: number;
    label: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // QR Code Generator state
  const [qrNodeId, setQrNodeId] = useState<string>("");
  const [qrBaseUrl, setQrBaseUrl] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

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

  const loadSettingsData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catRes, annRes, nodesRes] = await Promise.all([
        api.get<Category[]>("/api/admin/categories"),
        api.get<Announcement[]>("/api/admin/announcements"),
        api.get<MapNode[]>("/api/admin/nodes"),
      ]);
      const cats = Array.isArray(catRes.data) ? catRes.data : [];
      const anns = Array.isArray(annRes.data) ? annRes.data : [];
      const nodeList = Array.isArray(nodesRes.data) ? nodesRes.data : [];
      setCategories(cats);
      setAnnouncements(anns);
      setNodes(nodeList);
      if (nodeList.length > 0 && !qrNodeId) {
        setQrNodeId(String(nodeList[0].id));
      }
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถโหลดข้อมูลการตั้งค่าได้"));
    } finally {
      setIsLoading(false);
    }
  }, [showToast, qrNodeId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setQrBaseUrl(window.location.origin);
    }
    loadSettingsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedQrNode = useMemo(
    () => nodes.find((n) => String(n.id) === qrNodeId) ?? null,
    [nodes, qrNodeId]
  );

  const qrTargetUrl = useMemo(() => {
    const base = (qrBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
    if (!qrNodeId) return `${base}/`;
    return `${base}/?start_node=${qrNodeId}`;
  }, [qrBaseUrl, qrNodeId]);

  useEffect(() => {
    if (!qrTargetUrl) return;
    QRCode.toDataURL(qrTargetUrl, {
      width: 512,
      margin: 2,
      color: { dark: "#0F172A", light: "#FFFFFF" },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(""));
  }, [qrTargetUrl]);

  const handleDownloadQrPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    const safeName = (selectedQrNode?.name || `node-${qrNodeId}`)
      .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]+/g, "_")
      .slice(0, 40);
    link.download = `QR-start-node-${qrNodeId}-${safeName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("success", "ดาวน์โหลดไฟล์ QR Code PNG เรียบร้อยแล้ว");
  };

  const handleCopyQrLink = async () => {
    try {
      await navigator.clipboard.writeText(qrTargetUrl);
      showToast("success", "คัดลอกลิงก์ QR Code แล้ว");
    } catch {
      showToast("error", "ไม่สามารถคัดลอกลิงก์ได้");
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catModal) return;
    setIsSaving(true);
    try {
      const payload = {
        name: catModal.name.trim(),
        slug: catModal.slug.trim().toLowerCase(),
        color_hex: catModal.color_hex,
        badge_bg: catModal.badge_bg,
        sort_order: Number(catModal.sort_order),
        show_in_legend: catModal.show_in_legend,
      };
      if (catModal.id) {
        const res = await api.put<Category>(
          `/api/admin/categories/${catModal.id}`,
          payload
        );
        setCategories((prev) =>
          prev
            .map((c) => (c.id === res.data.id ? res.data : c))
            .sort((a, b) => a.sort_order - b.sort_order)
        );
        showToast("success", `บันทึกหมวดหมู่ "${res.data.name}" เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<Category>("/api/admin/categories", payload);
        setCategories((prev) =>
          [...prev, res.data].sort((a, b) => a.sort_order - b.sort_order)
        );
        showToast("success", `เพิ่มหมวดหมู่ "${res.data.name}" เรียบร้อยแล้ว`);
      }
      setCatModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกหมวดหมู่ได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annModal) return;
    setIsSaving(true);
    try {
      const payload = {
        title: annModal.title.trim(),
        message: annModal.message.trim(),
        level: annModal.level,
        is_active: annModal.is_active,
        expires_at: annModal.expires_at ? annModal.expires_at : null,
      };
      if (annModal.id) {
        const res = await api.put<Announcement>(
          `/api/admin/announcements/${annModal.id}`,
          payload
        );
        setAnnouncements((prev) =>
          prev.map((a) => (a.id === res.data.id ? res.data : a))
        );
        showToast("success", `อัปเดตประกาศ "${res.data.title}" เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<Announcement>(
          "/api/admin/announcements",
          payload
        );
        setAnnouncements((prev) => [res.data, ...prev]);
        showToast("success", `เพิ่มประกาศ "${res.data.title}" เรียบร้อยแล้ว`);
      }
      setAnnModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกประกาศได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.kind === "category") {
        await api.delete(`/api/admin/categories/${deleteTarget.id}`);
        setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      } else {
        await api.delete(`/api/admin/announcements/${deleteTarget.id}`);
        setAnnouncements((prev) =>
          prev.filter((a) => a.id !== deleteTarget.id)
        );
      }
      showToast("success", `ลบ "${deleteTarget.label}" เรียบร้อยแล้ว`);
      setDeleteTarget(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถลบข้อมูลได้"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const res = await api.get("/api/admin/export");
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
        2,
        "0"
      )}${String(now.getDate()).padStart(2, "0")}-${String(
        now.getHours()
      ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      const link = document.createElement("a");
      link.href = url;
      link.download = `hospital-nav-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("success", "ดาวน์โหลดไฟล์สำรองข้อมูล JSON เรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถส่งออกไฟล์สำรองข้อมูลได้"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-[#0F172A]">
            ประกาศ & QR Code
          </h1>
        </div>

        <button
          type="button"
          onClick={loadSettingsData}
          disabled={isLoading}
          className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          <span>รีเฟรช</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">

        <button
          type="button"
          onClick={() => setActiveTab("announcements")}
          className={`min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 cursor-pointer ${activeTab === "announcements"
              ? "bg-[#0F766E] text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
        >
          <Megaphone className="w-4 h-4" />
          <span>ประกาศหน้าเว็บ ({announcements.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("qrcode")}
          className={`min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 cursor-pointer ${activeTab === "qrcode"
              ? "bg-[#0F766E] text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
        >
          <QrCode className="w-4 h-4" />
          <span>สร้าง QR Code จุดเริ่มต้น</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("backup")}
          className={`min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 cursor-pointer ${activeTab === "backup"
              ? "bg-[#0F766E] text-white shadow-xs"
              : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
        >
          <DatabaseBackup className="w-4 h-4" />
          <span>สำรองข้อมูล JSON</span>
        </button>
      </div>

      {/* Tab 1: Categories */}
      {activeTab === "categories" && (
        <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-bold text-[#0F172A]">
              รายการหมวดหมู่ Filter Chips และสีคำอธิบายแผนที่
            </h2>
            <button
              type="button"
              onClick={() =>
                setCatModal({
                  id: null,
                  name: "",
                  slug: "",
                  color_hex: "#0F766E",
                  badge_bg: "#CCFBF1",
                  sort_order: categories.length + 1,
                  show_in_legend: true,
                })
              }
              className="min-h-[38px] px-3.5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>เพิ่มหมวดหมู่</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 w-16">ลำดับ</th>
                  <th className="py-3 px-4">ตัวอย่างป้าย & ชื่อหมวดหมู่</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">สีหลัก / พื้นหลัง</th>
                  <th className="py-3 px-4">แสดงใน Legend</th>
                  <th className="py-3 px-4 text-right w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-bold text-slate-600">
                      {cat.sort_order}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border"
                        style={{
                          color: cat.color_hex,
                          backgroundColor: cat.badge_bg,
                          borderColor: `${cat.color_hex}44`,
                        }}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-xs"
                          style={{ backgroundColor: cat.color_hex }}
                        />
                        {cat.name}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">
                      {cat.slug}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">
                      {cat.color_hex} / {cat.badge_bg}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${cat.show_in_legend
                            ? "bg-[#CCFBF1] text-[#047857]"
                            : "bg-slate-100 text-slate-500"
                          }`}
                      >
                        {cat.show_in_legend ? "แสดง" : "ไม่แสดง"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setCatModal({
                              id: cat.id,
                              name: cat.name,
                              slug: cat.slug,
                              color_hex: cat.color_hex,
                              badge_bg: cat.badge_bg,
                              sort_order: cat.sort_order,
                              show_in_legend: cat.show_in_legend,
                            })
                          }
                          className="w-9 h-9 rounded-lg hover:bg-teal-50 text-[#0F766E] flex items-center justify-center cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              kind: "category",
                              id: cat.id,
                              label: cat.name,
                            })
                          }
                          className="w-9 h-9 rounded-lg hover:bg-rose-50 text-[#BE123C] flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab 2: Announcements */}
      {activeTab === "announcements" && (
        <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-bold text-[#0F172A]">
              แถบประกาศประชาสัมพันธ์หน้าเว็บ
            </h2>
            <button
              type="button"
              onClick={() =>
                setAnnModal({
                  id: null,
                  title: "",
                  message: "",
                  level: "info",
                  is_active: true,
                  expires_at: "",
                })
              }
              className="min-h-[38px] px-3.5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>เพิ่มประกาศใหม่</span>
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {announcements.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                ยังไม่มีประกาศในระบบ
              </p>
            ) : (
              announcements.map((ann) => {
                const st = LEVEL_STYLES[ann.level] || LEVEL_STYLES.info;
                return (
                  <div
                    key={ann.id}
                    className="p-4 flex flex-wrap items-start justify-between gap-3 hover:bg-slate-50/70"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-md text-xs font-bold border ${st.cls}`}
                        >
                          {st.label}
                        </span>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${ann.is_active
                              ? "bg-[#CCFBF1] text-[#047857]"
                              : "bg-slate-200 text-slate-600"
                            }`}
                        >
                          {ann.is_active ? "กำลังแสดง" : "ปิดไว้"}
                        </span>
                        {ann.expires_at && (
                          <span className="text-xs text-slate-500">
                            หมดอายุ:{" "}
                            {new Date(ann.expires_at).toLocaleString("th-TH")}
                          </span>
                        )}
                      </div>
                      <h3 className="font-heading text-sm font-bold text-[#0F172A]">
                        {ann.title}
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {ann.message}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setAnnModal({
                            id: ann.id,
                            title: ann.title,
                            message: ann.message,
                            level: ann.level,
                            is_active: ann.is_active,
                            expires_at: ann.expires_at
                              ? ann.expires_at.slice(0, 16)
                              : "",
                          })
                        }
                        className="w-9 h-9 rounded-lg hover:bg-teal-50 text-[#0F766E] flex items-center justify-center cursor-pointer"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "announcement",
                            id: ann.id,
                            label: ann.title,
                          })
                        }
                        className="w-9 h-9 rounded-lg hover:bg-rose-50 text-[#BE123C] flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Tab 3: QR Code Generator */}
      {activeTab === "qrcode" && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs">
            <h2 className="font-heading text-base font-bold text-[#0F172A]">
              สร้าง QR Code ป้ายจุดเริ่มต้น (Start Node)
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              พิมพ์ติดตามประตูทางเข้าหรือโถงอาคาร เมื่อผู้ป่วยสแกน ระบบจะเปิดหน้าแผนที่พร้อมตั้งจุดเริ่มต้นที่จุดนี้ทันที (`/?start_node=ID`)
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                เลือกอาคารหรือจุดทางเข้า
              </label>
              <select
                value={qrNodeId}
                onChange={(e) => setQrNodeId(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
              >
                {nodes.map((n) => (
                  <option key={`qr-${n.id}`} value={String(n.id)}>
                    #{n.id} {n.name || "(จุดแยกทางเดิน)"}{" "}
                    {n.is_building ? "[อาคาร]" : "[ทางเข้า/จุดแยก]"}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                โดเมนเว็บ (Base URL)
              </label>
              <input
                type="url"
                value={qrBaseUrl}
                onChange={(e) => setQrBaseUrl(e.target.value)}
                placeholder="https://nav.sakonhospital.go.th"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-[#0F766E]"
              />
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between gap-2">
              <code className="text-xs text-[#0F766E] break-all font-semibold">
                {qrTargetUrl}
              </code>
              <button
                type="button"
                onClick={handleCopyQrLink}
                className="min-h-[34px] px-2.5 rounded-lg bg-white border border-slate-200 hover:bg-teal-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>คัดลอก</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadQrPng}
              disabled={!qrDataUrl}
              className="w-full min-h-[46px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>ดาวน์โหลด QR Code (.PNG)</span>
            </button>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col items-center justify-center text-center space-y-3 shadow-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sakon-hospital-logo.png"
              alt="โลโก้โรงพยาบาลสกลนคร"
              className="h-12 w-auto object-contain"
            />
            <div>
              <p className="text-xs font-bold text-[#0F766E] uppercase">
                สแกนเพื่อนำทางภายในโรงพยาบาลสกลนคร
              </p>
              <h3 className="font-heading text-base font-bold text-[#0F172A] mt-0.5">
                จุดเริ่มต้น: {selectedQrNode?.name || `จุด #${qrNodeId}`}
              </h3>
            </div>
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                alt="QR Code นำทางโรงพยาบาลสกลนคร"
                className="w-56 h-56 rounded-2xl border border-slate-200 p-2 bg-white shadow-xs"
              />
            ) : (
              <div className="w-56 h-56 rounded-2xl bg-slate-100 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#0F766E]" />
              </div>
            )}
            <p className="text-xs text-slate-500 font-mono">{qrTargetUrl}</p>
          </div>
        </section>
      )}

      {/* Tab 4: JSON Backup Export */}
      {activeTab === "backup" && (
        <section className="rounded-2xl bg-white border border-slate-200 p-6 max-w-2xl space-y-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 text-[#0F766E] flex items-center justify-center shrink-0">
              <DatabaseBackup className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                สำรองข้อมูลระบบนำทางทั้งหมด (Full JSON Backup)
              </h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                ส่งออกข้อมูลทั้งหมดจากฐานข้อมูลและโมเดล 3D เป็นไฟล์ JSON เดียว ได้แก่{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  map_nodes
                </code>
                ,{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  map_edges
                </code>
                ,{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  categories
                </code>
                ,{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  departments
                </code>
                ,{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  service_points
                </code>
                ,{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  announcements
                </code>
                ,{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  survey_tracks
                </code>{" "}
                และ{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  map_3d_overrides
                </code>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportBackup}
            disabled={isExporting}
            className="min-h-[46px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>Export Backup JSON</span>
          </button>
        </section>
      )}

      {/* Category Modal */}
      {catModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {catModal.id ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่ใหม่"}
              </h2>
              <button
                type="button"
                onClick={() => setCatModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCategory} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  ชื่อหมวดหมู่ *
                </label>
                <input
                  type="text"
                  required
                  value={catModal.name}
                  onChange={(e) =>
                    setCatModal({ ...catModal, name: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    Slug (ภาษาอังกฤษ) *
                  </label>
                  <input
                    type="text"
                    required
                    value={catModal.slug}
                    onChange={(e) =>
                      setCatModal({ ...catModal, slug: e.target.value })
                    }
                    placeholder="เช่น er_opd"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    ลำดับแสดงผล
                  </label>
                  <input
                    type="number"
                    value={catModal.sort_order}
                    onChange={(e) =>
                      setCatModal({
                        ...catModal,
                        sort_order: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    สีหลัก (Color Hex)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={catModal.color_hex}
                      onChange={(e) =>
                        setCatModal({ ...catModal, color_hex: e.target.value })
                      }
                      className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={catModal.color_hex}
                      onChange={(e) =>
                        setCatModal({ ...catModal, color_hex: e.target.value })
                      }
                      className="flex-1 min-h-[40px] px-2.5 rounded-xl border border-slate-200 text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    สีพื้นป้าย (Badge Bg)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={catModal.badge_bg}
                      onChange={(e) =>
                        setCatModal({ ...catModal, badge_bg: e.target.value })
                      }
                      className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={catModal.badge_bg}
                      onChange={(e) =>
                        setCatModal({ ...catModal, badge_bg: e.target.value })
                      }
                      className="flex-1 min-h-[40px] px-2.5 rounded-xl border border-slate-200 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={catModal.show_in_legend}
                  onChange={(e) =>
                    setCatModal({
                      ...catModal,
                      show_in_legend: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-[#0F766E]"
                />
                <span>แสดงในปุ่มคำอธิบายสีแผนที่ (Legend)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCatModal(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[40px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>บันทึกหมวดหมู่</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Announcement Modal */}
      {annModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {annModal.id ? "แก้ไขประกาศ" : "สร้างประกาศใหม่"}
              </h2>
              <button
                type="button"
                onClick={() => setAnnModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveAnnouncement} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  หัวข้อประกาศ *
                </label>
                <input
                  type="text"
                  required
                  value={annModal.title}
                  onChange={(e) =>
                    setAnnModal({ ...annModal, title: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  ข้อความรายละเอียด *
                </label>
                <textarea
                  rows={3}
                  required
                  value={annModal.message}
                  onChange={(e) =>
                    setAnnModal({ ...annModal, message: e.target.value })
                  }
                  className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    ระดับความสำคัญ
                  </label>
                  <select
                    value={annModal.level}
                    onChange={(e) =>
                      setAnnModal({ ...annModal, level: e.target.value })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                  >
                    <option value="info">ข้อมูลทั่วไป (สีฟ้า)</option>
                    <option value="warning">แจ้งเตือน / ปรับปรุง (สีเหลือง)</option>
                    <option value="urgent">ประกาศด่วน (สีแดง)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    วันเวลาหมดอายุ (ไม่บังคับ)
                  </label>
                  <input
                    type="datetime-local"
                    value={annModal.expires_at}
                    onChange={(e) =>
                      setAnnModal({ ...annModal, expires_at: e.target.value })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={annModal.is_active}
                  onChange={(e) =>
                    setAnnModal({ ...annModal, is_active: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#0F766E]"
                />
                <span>เปิดแสดงประกาศทันที</span>
              </label>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAnnModal(null)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[40px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>บันทึกประกาศ</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[1150] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-heading text-base font-bold text-[#BE123C]">
              ยืนยันการลบข้อมูล
            </h3>
            <p className="text-sm text-slate-600">
              คุณต้องการลบ <strong>{deleteTarget.label}</strong> ใช่หรือไม่?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="min-h-[40px] px-4 rounded-xl bg-[#BE123C] hover:bg-rose-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>ยืนยันลบ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[1200] max-w-sm rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-semibold ${toast.type === "success"
              ? "bg-[#0F766E] text-white border-teal-700"
              : "bg-[#FFE4E6] text-[#BE123C] border-rose-200"
            }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0" />
          ) : (
            <ShieldAlert className="w-5 h-5 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
