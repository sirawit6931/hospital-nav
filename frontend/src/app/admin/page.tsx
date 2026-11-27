"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ImageOff,
  Loader2,
  Map as MapIcon,
  Megaphone,
  RefreshCw,
  RouteOff,
  ShieldAlert,
  Stethoscope,
  Unlink,
  Wrench,
} from "lucide-react";
import {
  api,
  extractApiError,
  type Announcement,
  type Department,
  type MapEdge,
  type MapNode,
  type ServicePoint,
  type SurveyTrack,
} from "@/lib/api";

export default function AdminDashboardPage() {
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [surveys, setSurveys] = useState<SurveyTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reopeningEdgeId, setReopeningEdgeId] = useState<number | null>(null);
  const [confirmReopenEdge, setConfirmReopenEdge] = useState<MapEdge | null>(
    null
  );
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

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const [
        nodesRes,
        edgesRes,
        deptsRes,
        spRes,
        annRes,
        surveysRes,
      ] = await Promise.all([
        api.get<MapNode[]>("/api/admin/nodes"),
        api.get<MapEdge[]>("/api/admin/edges"),
        api.get<Department[]>("/api/admin/departments"),
        api.get<ServicePoint[]>("/api/admin/service-points"),
        api.get<Announcement[]>("/api/admin/announcements"),
        api.get<SurveyTrack[]>("/api/admin/surveys"),
      ]);
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setEdges(Array.isArray(edgesRes.data) ? edgesRes.data : []);
      setDepartments(Array.isArray(deptsRes.data) ? deptsRes.data : []);
      setServicePoints(Array.isArray(spRes.data) ? spRes.data : []);
      setAnnouncements(Array.isArray(annRes.data) ? annRes.data : []);
      setSurveys(Array.isArray(surveysRes.data) ? surveysRes.data : []);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถโหลดข้อมูลภาพรวมได้"));
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const healthAudit = useMemo(() => {
    const buildings = nodes.filter((n) => n.is_building);
    const activeEdges = edges.filter((e) => e.is_active);
    const closedEdges = edges.filter((e) => !e.is_active);
    const coveredEdges = edges.filter((e) => e.is_covered);

    // Build undirected adjacency list of active edges to detect unreachable / isolated buildings
    const adj = new Map<number, number[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of activeEdges) {
      adj.get(e.from_node)?.push(e.to_node);
      adj.get(e.to_node)?.push(e.from_node);
    }

    // Find largest connected component via BFS
    const visited = new Set<number>();
    let largestComponent = new Set<number>();
    for (const n of nodes) {
      if (visited.has(n.id)) continue;
      const comp = new Set<number>();
      const queue = [n.id];
      visited.add(n.id);
      comp.add(n.id);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const nxt of adj.get(curr) || []) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            comp.add(nxt);
            queue.push(nxt);
          }
        }
      }
      if (comp.size > largestComponent.size) {
        largestComponent = comp;
      }
    }

    const unreachableBuildings = buildings.filter((b) => {
      const deg = (adj.get(b.id) || []).length;
      if (deg === 0) return true;
      return largestComponent.size > 1 && !largestComponent.has(b.id);
    });

    const missingPhotoBuildings = buildings.filter(
      (b) => !b.image_url || b.image_url.trim() === ""
    );

    const deptCountByNode = new Map<number, number>();
    for (const d of departments) {
      deptCountByNode.set(d.node_id, (deptCountByNode.get(d.node_id) || 0) + 1);
    }
    const missingDeptBuildings = buildings.filter(
      (b) => (deptCountByNode.get(b.id) || 0) === 0
    );

    const nodeById = new Map<number, MapNode>();
    for (const n of nodes) nodeById.set(n.id, n);

    return {
      buildings,
      activeEdges,
      closedEdges,
      coveredEdges,
      unreachableBuildings,
      missingPhotoBuildings,
      missingDeptBuildings,
      nodeById,
    };
  }, [nodes, edges, departments]);

  const handleConfirmReopenEdge = async () => {
    if (!confirmReopenEdge) return;
    setReopeningEdgeId(confirmReopenEdge.id);
    try {
      const res = await api.put<MapEdge>(
        `/api/admin/edges/${confirmReopenEdge.id}`,
        { is_active: true, closure_reason: "" }
      );
      setEdges((prev) =>
        prev.map((item) => (item.id === res.data.id ? res.data : item))
      );
      showToast("success", `เปิดใช้งานเส้นทาง #${res.data.id} เรียบร้อยแล้ว`);
      setConfirmReopenEdge(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถเปิดใช้งานเส้นทางได้"));
    } finally {
      setReopeningEdgeId(null);
    }
  };

  const activeAnnouncementsCount = announcements.filter((a) => a.is_active).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-[#0F172A]">
            ภาพรวมและตรวจสุขภาพแผนที่
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            สรุปข้อมูลโครงข่ายนำทางและตรวจสอบจุดบกพร่องของอาคารในโรงพยาบาลสกลนคร
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadOverview}
            disabled={isLoading}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            <span>รีเฟรชข้อมูล</span>
          </button>
          <Link
            href="/admin/map"
            className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
          >
            <MapIcon className="w-4 h-4" />
            <span>เปิดแผนที่ & โมเดล 3D</span>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-12 flex flex-col items-center justify-center gap-2 text-slate-500">
          <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
          <span className="text-sm font-medium">กำลังตรวจสอบโครงข่ายแผนที่...</span>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-start justify-between gap-3 shadow-xs">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  อาคารทั้งหมด / จุดแยก
                </p>
                <p className="font-heading text-2xl font-bold text-[#0F172A] mt-1">
                  {healthAudit.buildings.length}
                  <span className="text-sm font-medium text-slate-400 ml-1.5">
                    / {nodes.length} จุด
                  </span>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  รอยเดินสำรวจ {surveys.length} เส้น
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-start justify-between gap-3 shadow-xs">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  แผนกและคลินิกในระบบ
                </p>
                <p className="font-heading text-2xl font-bold text-[#0F172A] mt-1">
                  {departments.length}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  จุดบริการ {servicePoints.length} รายการ
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
                <Stethoscope className="w-5 h-5" />
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-start justify-between gap-3 shadow-xs">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  เส้นทางปิดซ่อมแซมชั่วคราว
                </p>
                <p
                  className={`font-heading text-2xl font-bold mt-1 ${
                    healthAudit.closedEdges.length > 0
                      ? "text-[#BE123C]"
                      : "text-[#047857]"
                  }`}
                >
                  {healthAudit.closedEdges.length}
                  <span className="text-sm font-medium text-slate-400 ml-1.5">
                    / {edges.length} เส้น
                  </span>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  มีหลังคา {healthAudit.coveredEdges.length} เส้น
                </p>
              </div>
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  healthAudit.closedEdges.length > 0
                    ? "bg-[#FFE4E6] text-[#BE123C]"
                    : "bg-[#CCFBF1] text-[#047857]"
                }`}
              >
                <RouteOff className="w-5 h-5" />
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-start justify-between gap-3 shadow-xs">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  ประกาศที่กำลังแสดงผล
                </p>
                <p className="font-heading text-2xl font-bold text-[#0F172A] mt-1">
                  {activeAnnouncementsCount}
                  <span className="text-sm font-medium text-slate-400 ml-1.5">
                    / {announcements.length}
                  </span>
                </p>
                <Link
                  href="/admin/settings"
                  className="text-xs font-semibold text-[#0F766E] hover:underline mt-1 inline-flex items-center gap-1"
                >
                  <span>จัดการประกาศ & QR</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <Megaphone className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Temporarily Closed Edges Alert Panel */}
          {healthAudit.closedEdges.length > 0 && (
            <section className="rounded-2xl bg-rose-50/70 border border-rose-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[#BE123C]">
                  <Wrench className="w-5 h-5" />
                  <h2 className="font-heading text-base font-bold">
                    เส้นทางที่กำลังปิดปรับปรุง ({healthAudit.closedEdges.length}{" "}
                    เส้น)
                  </h2>
                </div>
                <Link
                  href="/admin/map"
                  className="text-xs font-bold text-[#BE123C] hover:underline"
                >
                  ดูบนแผนที่
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {healthAudit.closedEdges.map((edge) => {
                  const fromName =
                    healthAudit.nodeById.get(edge.from_node)?.name ||
                    `จุด #${edge.from_node}`;
                  const toName =
                    healthAudit.nodeById.get(edge.to_node)?.name ||
                    `จุด #${edge.to_node}`;
                  return (
                    <div
                      key={edge.id}
                      className="rounded-xl bg-white border border-rose-200 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#0F172A] truncate">
                          #{edge.id} {fromName} ↔ {toName}
                        </p>
                        <p className="text-xs text-rose-700 mt-0.5">
                          เหตุผล:{" "}
                          {edge.closure_reason || "ไม่ได้ระบุเหตุผลการปิดเส้นทาง"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmReopenEdge(edge)}
                        className="min-h-[36px] px-3 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold shrink-0 cursor-pointer"
                      >
                        เปิดเส้นทาง
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 3-Column Map Health Audit */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 1. Unreachable Buildings */}
            <section className="rounded-2xl bg-white border border-slate-200 flex flex-col overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Unlink className="w-4 h-4 text-[#BE123C]" />
                  <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                    ตึกที่ยังไม่มีเส้นเชื่อม ({healthAudit.unreachableBuildings.length})
                  </h2>
                </div>
                <Link
                  href="/admin/map"
                  className="text-xs font-bold text-[#0F766E] hover:underline"
                >
                  เชื่อมเส้นทาง
                </Link>
              </div>
              <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                {healthAudit.unreachableBuildings.length === 0 ? (
                  <div className="py-6 text-center text-xs font-semibold text-[#047857] flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-6 h-6" />
                    <span>อาคารทุกหลังเชื่อมต่อโครงข่ายนำทางครบแล้ว</span>
                  </div>
                ) : (
                  healthAudit.unreachableBuildings.map((b) => (
                    <div
                      key={`unreach-${b.id}`}
                      className="rounded-xl bg-rose-50/70 border border-rose-200 px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#0F172A] truncate">
                          #{b.id} {b.name}
                        </p>
                        <p className="text-[11px] text-rose-700">
                          ไม่สามารถนำทางถึงได้ (Unreachable)
                        </p>
                      </div>
                      <AlertTriangle className="w-4 h-4 text-[#BE123C] shrink-0" />
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 2. Buildings Missing Photos */}
            <section className="rounded-2xl bg-white border border-slate-200 flex flex-col overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ImageOff className="w-4 h-4 text-amber-600" />
                  <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                    ตึกที่ยังไม่มีรูปหน้าอาคาร (
                    {healthAudit.missingPhotoBuildings.length})
                  </h2>
                </div>
                <Link
                  href="/admin/directory"
                  className="text-xs font-bold text-[#0F766E] hover:underline"
                >
                  อัปโหลดรูป
                </Link>
              </div>
              <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                {healthAudit.missingPhotoBuildings.length === 0 ? (
                  <div className="py-6 text-center text-xs font-semibold text-[#047857] flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-6 h-6" />
                    <span>อาคารทุกหลังมีรูปภาพประกอบครบถ้วนแล้ว</span>
                  </div>
                ) : (
                  healthAudit.missingPhotoBuildings.map((b) => (
                    <div
                      key={`nophoto-${b.id}`}
                      className="rounded-xl bg-amber-50/60 border border-amber-200 px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-semibold text-[#0F172A] truncate">
                        #{b.id} {b.name}
                      </span>
                      <Link
                        href="/admin/directory"
                        className="text-[11px] font-bold text-amber-800 hover:underline shrink-0"
                      >
                        เพิ่มรูป
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 3. Buildings Missing Departments */}
            <section className="rounded-2xl bg-white border border-slate-200 flex flex-col overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-sky-600" />
                  <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                    ตึกที่ยังไม่มีข้อมูลแผนก (
                    {healthAudit.missingDeptBuildings.length})
                  </h2>
                </div>
                <Link
                  href="/admin/directory"
                  className="text-xs font-bold text-[#0F766E] hover:underline"
                >
                  เพิ่มแผนก
                </Link>
              </div>
              <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                {healthAudit.missingDeptBuildings.length === 0 ? (
                  <div className="py-6 text-center text-xs font-semibold text-[#047857] flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-6 h-6" />
                    <span>อาคารทุกหลังมีข้อมูลแผนกครบแล้ว</span>
                  </div>
                ) : (
                  healthAudit.missingDeptBuildings.map((b) => (
                    <div
                      key={`nodept-${b.id}`}
                      className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-semibold text-[#0F172A] truncate">
                        #{b.id} {b.name}
                      </span>
                      <Link
                        href="/admin/directory"
                        className="text-[11px] font-bold text-[#0F766E] hover:underline shrink-0"
                      >
                        เพิ่มแผนก
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {/* Confirm Reopen Edge Modal */}
      {confirmReopenEdge && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-heading text-base font-bold text-[#0F172A]">
              ยืนยันเปิดใช้งานเส้นทาง #{confirmReopenEdge.id}
            </h3>
            <p className="text-sm text-slate-600">
              ต้องการเปิดใช้งานเส้นทางนี้กลับมาในระบบคำนวณเส้นทางและล้างเหตุผลการปิดซ่อมแซมใช่หรือไม่?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmReopenEdge(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmReopenEdge}
                disabled={reopeningEdgeId === confirmReopenEdge.id}
                className="min-h-[40px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {reopeningEdgeId === confirmReopenEdge.id && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>ยืนยันเปิดเส้นทาง</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[1150] max-w-sm rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-semibold ${
            toast.type === "success"
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
