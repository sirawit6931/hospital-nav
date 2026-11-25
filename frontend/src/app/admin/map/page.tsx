"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Accessibility,
  CheckCircle2,
  Compass,
  GitBranch,
  Hospital,
  Loader2,
  LogOut,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Route,
  ShieldAlert,
  ToggleLeft,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  clearAdminToken,
  extractApiError,
  getAdminToken,
  type MapEdge,
  type MapNode,
  type SurveyTrack,
  type UploadResponse,
} from "@/lib/api";
import type { AdminEditorMode } from "@/components/maps/AdminMapEditor";

const AdminMapEditor = dynamic(
  () => import("@/components/maps/AdminMapEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center gap-2 text-slate-500">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
        <span className="text-sm font-medium">กำลังโหลดแผนที่จัดการข้อมูล...</span>
      </div>
    ),
  }
);

interface NodeFormState {
  id: number | null;
  name: string;
  is_building: boolean;
  keywords: string;
  indoor_guide: string;
  image_url: string;
  lat: number;
  lng: number;
}

interface DeleteConfirmState {
  type: "node" | "edge" | "survey";
  id: number;
  label: string;
}

export default function AdminMapPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [mode, setMode] = useState<AdminEditorMode>("add_node");
  const [showSurveys, setShowSurveys] = useState(false);

  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [surveys, setSurveys] = useState<SurveyTrack[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Connect edge state
  const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<number | null>(
    null
  );
  const [edgeInstruction, setEdgeInstruction] = useState("");
  const [edgeWheelchair, setEdgeWheelchair] = useState(true);

  // Node add/edit modal state
  const [nodeModal, setNodeModal] = useState<NodeFormState | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<DeleteConfirmState | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Toast feedback
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

  const loadAllMapData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const [nodesRes, edgesRes, surveysRes] = await Promise.all([
        api.get<MapNode[]>("/api/admin/nodes"),
        api.get<MapEdge[]>("/api/admin/edges"),
        api.get<SurveyTrack[]>("/api/admin/surveys"),
      ]);
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setEdges(Array.isArray(edgesRes.data) ? edgesRes.data : []);
      setSurveys(Array.isArray(surveysRes.data) ? surveysRes.data : []);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถโหลดข้อมูลแผนที่ได้"));
    } finally {
      setIsLoadingData(false);
    }
  }, [showToast]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      router.replace("/admin/login");
      return;
    }
    setAuthChecked(true);
    loadAllMapData();
  }, [router, loadAllMapData]);

  const handleLogout = () => {
    clearAdminToken();
    router.replace("/admin/login");
  };

  const handleModeChange = (nextMode: AdminEditorMode) => {
    setMode(nextMode);
    setSelectedSourceNodeId(null);
  };

  // Mode 1: Click empty map -> Open modal to create a new Node
  const handleMapClick = (lat: number, lng: number) => {
    if (mode !== "add_node") return;
    setNodeModal({
      id: null,
      name: "",
      is_building: false,
      keywords: "",
      indoor_guide: "",
      image_url: "",
      lat: Number(lat.toFixed(7)),
      lng: Number(lng.toFixed(7)),
    });
  };

  // Click existing node -> behavior depends on active mode
  const handleNodeClick = async (node: MapNode) => {
    if (mode === "add_node") {
      setNodeModal({
        id: node.id,
        name: node.name || "",
        is_building: node.is_building,
        keywords: node.keywords || "",
        indoor_guide: node.indoor_guide || "",
        image_url: node.image_url || "",
        lat: node.lat,
        lng: node.lng,
      });
      return;
    }

    if (mode === "connect_edge") {
      if (selectedSourceNodeId === null) {
        setSelectedSourceNodeId(node.id);
        showToast(
          "success",
          `เลือกจุดเริ่มต้น #${node.id} (${node.name || "จุดทางเดิน"}) แล้ว กรุณาคลิกจุดปลายทาง`
        );
        return;
      }

      if (selectedSourceNodeId === node.id) {
        setSelectedSourceNodeId(null);
        return;
      }

      try {
        const res = await api.post<MapEdge>("/api/admin/edges", {
          from_node: selectedSourceNodeId,
          to_node: node.id,
          instruction: edgeInstruction.trim(),
          is_wheelchair_friendly: edgeWheelchair,
        });
        setEdges((prev) => [...prev, res.data]);
        setSelectedSourceNodeId(null);
        setEdgeInstruction("");
        showToast(
          "success",
          `เชื่อมเส้นทางสำเร็จ (${Math.round(res.data.distance_m)} เมตร)`
        );
      } catch (err) {
        showToast("error", extractApiError(err, "ไม่สามารถเชื่อมเส้นทางได้"));
      }
      return;
    }

    if (mode === "delete") {
      setDeleteTarget({
        type: "node",
        id: node.id,
        label: `จุด #${node.id} ${node.name || "(จุดแยกทางเดิน)"}`,
      });
    }
  };

  // Click existing edge -> toggle active or delete
  const handleEdgeClick = async (edge: MapEdge) => {
    if (mode === "toggle_edge") {
      try {
        const res = await api.patch<MapEdge>(`/api/admin/edges/${edge.id}`);
        setEdges((prev) =>
          prev.map((item) => (item.id === edge.id ? res.data : item))
        );
        showToast(
          "success",
          res.data.is_active
            ? `เปิดใช้งานเส้นทาง #${edge.id} แล้ว`
            : `ปิดเส้นทาง #${edge.id} ชั่วคราวแล้ว`
        );
      } catch (err) {
        showToast(
          "error",
          extractApiError(err, "ไม่สามารถเปลี่ยนสถานะเส้นทางได้")
        );
      }
      return;
    }

    if (mode === "delete") {
      setDeleteTarget({
        type: "edge",
        id: edge.id,
        label: `เส้นเชื่อม #${edge.id} (จุด ${edge.from_node} - ${edge.to_node}, ${Math.round(
          edge.distance_m
        )} ม.)`,
      });
    }
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !nodeModal) return;

    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post<UploadResponse>("/api/admin/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setNodeModal((prev) =>
        prev ? { ...prev, image_url: res.data.image_url || res.data.url } : null
      );
      showToast("success", "อัปโหลดรูปภาพหน้าอาคารเรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "อัปโหลดรูปภาพไม่สำเร็จ"));
    } finally {
      setIsUploadingImage(false);
      e.target.value = "";
    }
  };

  const handleSaveNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeModal) return;

    setIsSavingNode(true);
    try {
      const payload = {
        name: nodeModal.name.trim(),
        is_building: nodeModal.is_building,
        keywords: nodeModal.keywords.trim(),
        indoor_guide: nodeModal.indoor_guide.trim(),
        image_url: nodeModal.image_url.trim(),
        lat: Number(nodeModal.lat),
        lng: Number(nodeModal.lng),
      };

      if (nodeModal.id) {
        const res = await api.put<MapNode>(
          `/api/admin/nodes/${nodeModal.id}`,
          payload
        );
        setNodes((prev) =>
          prev.map((n) => (n.id === res.data.id ? res.data : n))
        );
        // Refresh edges in case node moved and PostGIS updated edge lengths
        const edgesRes = await api.get<MapEdge[]>("/api/admin/edges");
        setEdges(Array.isArray(edgesRes.data) ? edgesRes.data : []);
        showToast("success", `อัปเดตข้อมูลจุด #${res.data.id} เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<MapNode>("/api/admin/nodes", payload);
        setNodes((prev) => [...prev, res.data]);
        showToast("success", `เพิ่มจุด #${res.data.id} เรียบร้อยแล้ว`);
      }
      setNodeModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกข้อมูลจุดได้"));
    } finally {
      setIsSavingNode(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.type === "node") {
        await api.delete(`/api/admin/nodes/${deleteTarget.id}`);
        setNodes((prev) => prev.filter((n) => n.id !== deleteTarget.id));
        setEdges((prev) =>
          prev.filter(
            (e) => e.from_node !== deleteTarget.id && e.to_node !== deleteTarget.id
          )
        );
        showToast("success", `ลบ${deleteTarget.label}เรียบร้อยแล้ว`);
      } else if (deleteTarget.type === "edge") {
        await api.delete(`/api/admin/edges/${deleteTarget.id}`);
        setEdges((prev) => prev.filter((e) => e.id !== deleteTarget.id));
        showToast("success", `ลบ${deleteTarget.label}เรียบร้อยแล้ว`);
      } else {
        await api.delete(`/api/admin/surveys/${deleteTarget.id}`);
        setSurveys((prev) => prev.filter((s) => s.id !== deleteTarget.id));
        showToast("success", `ลบรอยเดินสำรวจเรียบร้อยแล้ว`);
      }
      setDeleteTarget(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ลบข้อมูลไม่สำเร็จ"));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="h-dvh bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
      </div>
    );
  }

  const buildingCount = nodes.filter((n) => n.is_building).length;
  const closedEdgeCount = edges.filter((e) => !e.is_active).length;

  const modeHint: Record<AdminEditorMode, string> = {
    add_node:
      "คลิกพื้นที่ว่างบนแผนที่เพื่อเพิ่มตึก/จุดแยกใหม่ หรือคลิกจุดเดิมเพื่อแก้ไขข้อมูล",
    connect_edge: selectedSourceNodeId
      ? `เลือกจุดเริ่มต้น #${selectedSourceNodeId} แล้ว — คลิกจุดที่ 2 เพื่อเชื่อมเส้นทาง (คำนวณระยะทาง PostGIS อัตโนมัติ)`
      : "คลิกจุดที่ 1 จากนั้นคลิกจุดที่ 2 เพื่อสร้างเส้นเชื่อมทางเดิน",
    toggle_edge:
      "คลิกที่เส้นทางใดก็ได้เพื่อสลับสถานะ เปิดใช้งาน / ปิดปรับปรุงชั่วคราว (เส้นประสีแดง)",
    delete: "คลิกที่จุด (Node) หรือเส้นเชื่อม (Edge) ที่ต้องการลบออกจากแผนที่",
  };

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden bg-[#F8FAFC]">
      {/* Top Admin Header */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0F766E] text-white flex items-center justify-center shrink-0">
            <Hospital className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading text-base font-bold text-[#0F172A] leading-tight">
              Admin Map Editor • โรงพยาบาลสกลนคร
            </h1>
            <p className="text-xs text-slate-500">
              {nodes.length} จุด ({buildingCount} อาคาร) • {edges.length}{" "}
              เส้นเชื่อม ({closedEdgeCount} ปิดชั่วคราว) • {surveys.length}{" "}
              รอยเดินสำรวจ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAllMapData}
            disabled={isLoadingData}
            className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoadingData ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">รีเฟรชข้อมูล</span>
          </button>

          <Link
            href="/admin/survey"
            className="min-h-[44px] px-3.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5"
          >
            <Compass className="w-4 h-4" />
            <span>เก็บพิกัดภาคสนาม</span>
          </Link>

          <Link
            href="/"
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
          >
            <MapIcon className="w-4 h-4" />
            <span className="hidden sm:inline">หน้าผู้ใช้</span>
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[44px] px-3.5 rounded-xl border border-rose-200 bg-[#FFE4E6]/60 hover:bg-[#FFE4E6] text-xs font-bold text-[#BE123C] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">ออกจากระบบ</span>
          </button>
        </div>
      </header>

      {/* 5-Mode Toolbar */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleModeChange("add_node")}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
              mode === "add_node"
                ? "bg-[#0F766E] border-[#0F766E] text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-700 hover:border-teal-300"
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>1. เพิ่ม/แก้ไขตึกและจุด</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange("connect_edge")}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
              mode === "connect_edge"
                ? "bg-[#0F766E] border-[#0F766E] text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-700 hover:border-teal-300"
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>2. เชื่อมเส้นทาง</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange("toggle_edge")}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
              mode === "toggle_edge"
                ? "bg-[#1D4ED8] border-[#1D4ED8] text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-700 hover:border-blue-300"
            }`}
          >
            <ToggleLeft className="w-4 h-4" />
            <span>3. เปิด/ปิดเส้นทาง</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange("delete")}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
              mode === "delete"
                ? "bg-[#BE123C] border-[#BE123C] text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-700 hover:border-rose-300"
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>4. ลบจุด / เส้น</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSurveys((prev) => !prev)}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
              showSurveys
                ? "bg-orange-500 border-orange-500 text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-700 hover:border-orange-300"
            }`}
          >
            <Route className="w-4 h-4" />
            <span>
              5. แสดง Survey Tracks ({surveys.length})
            </span>
          </button>
        </div>

        {/* Context-sensitive toolbar hint + edge metadata inputs when in connect_edge mode */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-600 font-medium">{modeHint[mode]}</span>

          {mode === "connect_edge" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={edgeInstruction}
                onChange={(e) => setEdgeInstruction(e.target.value)}
                placeholder="คำอธิบายทางเดิน (ไม่บังคับ)"
                className="min-h-[36px] px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-[#0F172A] w-56 focus:outline-none focus:border-[#0F766E]"
              />
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={edgeWheelchair}
                  onChange={(e) => setEdgeWheelchair(e.target.checked)}
                  className="w-4 h-4 accent-[#0F766E]"
                />
                <Accessibility className="w-3.5 h-3.5 text-[#0F766E]" />
                <span>รถเข็นผ่านได้</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Main Editor Workspace */}
      <div className="flex-1 min-h-0 flex relative">
        <div className="flex-1 relative min-w-0">
          <AdminMapEditor
            mode={mode}
            nodes={nodes}
            edges={edges}
            surveys={surveys}
            showSurveys={showSurveys}
            selectedSourceNodeId={selectedSourceNodeId}
            onMapClick={handleMapClick}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
          />
        </div>

        {/* Collapsible Survey Tracks Panel when Mode 5 is active */}
        {showSurveys && (
          <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-orange-500" />
                <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                  รอยเดินสำรวจ ({surveys.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowSurveys(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
                aria-label="ปิดแผง Survey Tracks"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {surveys.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  ยังไม่มีรอยเดินสำรวจในระบบ สามารถบันทึกได้จากหน้า
                  &ldquo;เก็บพิกัดภาคสนาม&rdquo;
                </p>
              ) : (
                surveys.map((track) => (
                  <div
                    key={track.id}
                    className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#0F172A] truncate">
                        {track.name}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {Array.isArray(track.points_json)
                          ? track.points_json.length
                          : 0}{" "}
                        พิกัด (เส้นสีส้มบนแผนที่)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({
                          type: "survey",
                          id: track.id,
                          label: `รอยเดินสำรวจ "${track.name}"`,
                        })
                      }
                      className="w-9 h-9 rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 cursor-pointer"
                      aria-label={`ลบรอยเดิน ${track.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        {/* Toast Notification */}
        {toast && (
          <div
            className={`fixed bottom-5 right-5 z-[1000] max-w-sm rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-semibold ${
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

      {/* Add / Edit Node Modal */}
      {nodeModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {nodeModal.id
                  ? `แก้ไขข้อมูลจุด #${nodeModal.id}`
                  : "เพิ่มตึกหรือจุดแยกทางเดินใหม่"}
              </h2>
              <button
                type="button"
                onClick={() => setNodeModal(null)}
                className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNode} className="p-5 space-y-4">
              {/* Lat / Lng */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={nodeModal.lat}
                    onChange={(e) =>
                      setNodeModal((prev) =>
                        prev ? { ...prev, lat: Number(e.target.value) } : null
                      )
                    }
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={nodeModal.lng}
                    onChange={(e) =>
                      setNodeModal((prev) =>
                        prev ? { ...prev, lng: Number(e.target.value) } : null
                      )
                    }
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              {/* Is Building checkbox */}
              <label className="flex items-center gap-3 p-3.5 rounded-xl bg-teal-50/70 border border-teal-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nodeModal.is_building}
                  onChange={(e) =>
                    setNodeModal((prev) =>
                      prev ? { ...prev, is_building: e.target.checked } : null
                    )
                  }
                  className="w-5 h-5 accent-[#0F766E]"
                />
                <div>
                  <span className="block text-sm font-bold text-[#0F172A]">
                    เป็นอาคาร / จุดหมายปลายทาง (is_building)
                  </span>
                  <span className="block text-xs text-slate-600">
                    ติ๊กเลือกเพื่อให้แสดงในช่องค้นหาอาคารสำหรับผู้ป่วยทั่วไป
                  </span>
                </div>
              </label>

              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  ชื่ออาคารหรือชื่อจุด
                </label>
                <input
                  type="text"
                  value={nodeModal.name}
                  onChange={(e) =>
                    setNodeModal((prev) =>
                      prev ? { ...prev, name: e.target.value } : null
                    )
                  }
                  placeholder="เช่น ตึก 8 ชั้น (อาคารหลักกลาง) หรือ ทางแยกหน้าป้อม รปภ."
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              {/* Keywords */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  คำค้นหาและแผนกภายใน (Keywords)
                </label>
                <input
                  type="text"
                  value={nodeModal.keywords}
                  onChange={(e) =>
                    setNodeModal((prev) =>
                      prev ? { ...prev, keywords: e.target.value } : null
                    )
                  }
                  placeholder="คั่นด้วยเครื่องหมายจุลภาค เช่น MICU, Stroke, หอผู้ป่วยใน, ห้องยา"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              {/* Indoor Guide */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  คำแนะนำการเดินภายในอาคาร (Indoor Guide)
                </label>
                <textarea
                  rows={3}
                  value={nodeModal.indoor_guide}
                  onChange={(e) =>
                    setNodeModal((prev) =>
                      prev ? { ...prev, indoor_guide: e.target.value } : null
                    )
                  }
                  placeholder="เช่น เข้าประตูหลักแล้วขึ้นลิฟต์ด้านขวา ชั้น 1 ห้องยา, ชั้น 2 MICU"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              {/* Building Photo Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">
                  รูปภาพหน้าอาคาร
                </label>
                <div className="flex items-center gap-2">
                  <label className="min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-sm font-semibold text-slate-800 inline-flex items-center gap-2 cursor-pointer transition-colors">
                    {isUploadingImage ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#0F766E]" />
                    ) : (
                      <Upload className="w-4 h-4 text-[#0F766E]" />
                    )}
                    <span>
                      {isUploadingImage ? "กำลังอัปโหลด..." : "อัปโหลดรูปภาพ"}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleUploadImage}
                      disabled={isUploadingImage}
                      className="hidden"
                    />
                  </label>
                  {nodeModal.image_url && (
                    <button
                      type="button"
                      onClick={() =>
                        setNodeModal((prev) =>
                          prev ? { ...prev, image_url: "" } : null
                        )
                      }
                      className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      ลบรูปภาพ
                    </button>
                  )}
                </div>

                {nodeModal.image_url && (
                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={nodeModal.image_url}
                      alt="ตัวอย่างภาพหน้าอาคาร"
                      className="w-full h-36 object-cover"
                    />
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNodeModal(null)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSavingNode}
                  className="min-h-[44px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  {isSavingNode && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>บันทึกข้อมูล</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFE4E6] text-[#BE123C] flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-[#0F172A]">
                  ยืนยันการลบข้อมูล
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  ต้องการลบ {deleteTarget.label} ออกจากระบบใช่หรือไม่?
                  {deleteTarget.type === "node" &&
                    " (เส้นเชื่อมที่ต่อกับจุดนี้จะถูกลบออกด้วย)"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="min-h-[44px] px-4 rounded-xl bg-[#BE123C] hover:bg-rose-800 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>ยืนยันการลบ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
