"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Accessibility,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Building2,
  CheckCircle2,
  Copy,
  CopyPlus,
  ExternalLink,
  GitBranch,
  GitMerge,
  Globe,
  Info,
  Link2,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCcw,
  Route,
  Save,
  Scissors,
  ShieldAlert,
  SlidersHorizontal,
  ToggleLeft,
  Trash2,
  Umbrella,
  Undo2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import {
  api,
  extractApiError,
  type MapEdge,
  type MapNode,
  type MapVersion,
  type SurveyTrack,
  type UploadResponse,
} from "@/lib/api";
import type { AdminEditorMode } from "@/components/maps/AdminMapEditor";
import {
  EMPTY_MAP_3D_OVERRIDES,
  WALL_MAP_COLOR_PRESETS,
  type Building3DOverride,
  type Building3DProps,
  type Custom3DPart,
  type Map3DOverridesPayload,
  type MapViewMode,
} from "@/lib/hospital3d";

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

const Admin3DMapEditor = dynamic(
  () => import("@/components/maps/Admin3DMapEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#E6EDF4] flex flex-col items-center justify-center gap-2 text-slate-600">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
        <span className="text-sm font-medium">กำลังโหลดแผนที่ 3D ผู้ดูแลระบบ...</span>
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

interface EdgeFormState {
  id: number;
  from_node: number;
  to_node: number;
  distance_m: number;
  is_active: boolean;
  is_wheelchair_friendly: boolean;
  is_covered: boolean;
  is_indoor_passthrough: boolean;
  instruction: string;
  closure_reason: string;
}

export default function AdminMapPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>("3d");

  const [mode, setMode] = useState<AdminEditorMode>("add_node");
  const [showSurveys, setShowSurveys] = useState(false);

  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [surveys, setSurveys] = useState<SurveyTrack[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Map Versioning state (Live / Clone Draft / Switch Live)
  const [versions, setVersions] = useState<MapVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [isVersionBusy, setIsVersionBusy] = useState(false);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneDesc, setCloneDesc] = useState("");
  const [editVersionModal, setEditVersionModal] = useState<{
    id: number;
    name: string;
    description: string;
    is_live: boolean;
  } | null>(null);
  const [publishConfirmVersion, setPublishConfirmVersion] =
    useState<MapVersion | null>(null);
  const [liveWarningDismissed, setLiveWarningDismissed] = useState(false);

  // Full-Viewport UI & Floating Popover state
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [modeInfoOpen, setModeInfoOpen] = useState(false);
  const [panel3DCollapsed, setPanel3DCollapsed] = useState(false);

  // Per-track Survey visibility, Merge Tracks, and Split Track state
  const [visibleSurveyIds, setVisibleSurveyIds] = useState<number[]>([]);
  const [splitTrackId, setSplitTrackId] = useState<number | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [mergeZone, setMergeZone] = useState("");
  const [mergeDeleteOriginals, setMergeDeleteOriginals] = useState(false);
  const [isSurveyBusy, setIsSurveyBusy] = useState(false);

  // Connect edge state
  const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<number | null>(
    null
  );
  const [edgeInstruction, setEdgeInstruction] = useState("");
  const [edgeWheelchair, setEdgeWheelchair] = useState(true);
  const [edgeCovered, setEdgeCovered] = useState(false);
  const [edgeIndoor, setEdgeIndoor] = useState(false);

  // Edge edit modal state (Mode 3)
  const [edgeModal, setEdgeModal] = useState<EdgeFormState | null>(null);
  const [isSavingEdge, setIsSavingEdge] = useState(false);

  // Node add/edit modal state
  const [nodeModal, setNodeModal] = useState<NodeFormState | null>(null);
  const [focusNodeApplied, setFocusNodeApplied] = useState(false);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Support /admin/map?focus_node=<id> deep-link from "ดูตำแหน่งบนแผนที่ 3D"
  useEffect(() => {
    if (focusNodeApplied || nodes.length === 0 || typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const focusParam = params.get("focus_node");
    if (!focusParam) return;
    const focusId = Number(focusParam);
    if (!Number.isFinite(focusId) || focusId <= 0) return;
    const target = nodes.find((n) => n.id === focusId);
    if (!target) return;
    setFocusNodeApplied(true);
    setMapViewMode("3d");
    setNodeModal({
      id: target.id,
      name: target.name || "",
      is_building: target.is_building,
      keywords: target.keywords || "",
      indoor_guide: target.indoor_guide || "",
      image_url: target.image_url || "",
      lat: target.lat,
      lng: target.lng,
    });
  }, [nodes, focusNodeApplied]);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<DeleteConfirmState | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // 3D Building Customizer state (free drag/resize/rotate/nudge, satellite underlay, undo, multi-block & node link)
  const [overrides3D, setOverrides3D] = useState<Map3DOverridesPayload>(
    EMPTY_MAP_3D_OVERRIDES
  );
  const [selected3D, setSelected3D] = useState<Building3DOverride | null>(null);
  const [selected3DIsCustom, setSelected3DIsCustom] = useState(false);
  const [selected3DIsWing, setSelected3DIsWing] = useState(false);
  const [isSaving3D, setIsSaving3D] = useState(false);
  const [hasUnsaved3D, setHasUnsaved3D] = useState(false);
  const [clickToMove3D, setClickToMove3D] = useState(false);
  const [clickToPlace3D, setClickToPlace3D] = useState(false);
  const [nudgeStepM, setNudgeStepM] = useState<number>(0.5);
  const [showSatelliteUnderlay, setShowSatelliteUnderlay] = useState(false);
  const [buildingOpacity, setBuildingOpacity] = useState<number>(0.92);
  const [mapViewportCenter, setMapViewportCenter] = useState<[number, number]>([
    17.1633, 104.1581,
  ]);
  const [undoStack, setUndoStack] = useState<
    {
      overrides3D: Map3DOverridesPayload;
      selected3D: Building3DOverride | null;
      selected3DIsCustom: boolean;
      selected3DIsWing: boolean;
    }[]
  >([]);

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

  const loadVersionData = useCallback(
    async (versionId: number) => {
      setIsLoadingData(true);
      try {
        const [nodesRes, edgesRes, surveysRes, overridesRes] = await Promise.all([
          api.get<MapNode[]>("/api/admin/nodes", {
            params: { version_id: versionId },
          }),
          api.get<MapEdge[]>("/api/admin/edges", {
            params: { version_id: versionId },
          }),
          api.get<SurveyTrack[]>("/api/admin/surveys"),
          api
            .get<Map3DOverridesPayload>("/api/map-3d-overrides", {
              params: { version_id: versionId },
            })
            .catch(() => ({ data: EMPTY_MAP_3D_OVERRIDES })),
        ]);
        setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
        setEdges(Array.isArray(edgesRes.data) ? edgesRes.data : []);
        const loadedSurveys = Array.isArray(surveysRes.data)
          ? surveysRes.data
          : [];
        setSurveys(loadedSurveys);
        setVisibleSurveyIds((prev) => {
          if (prev.length === 0) return loadedSurveys.map((s) => s.id);
          const validIds = new Set(loadedSurveys.map((s) => s.id));
          const kept = prev.filter((id) => validIds.has(id));
          return kept.length > 0 ? kept : loadedSurveys.map((s) => s.id);
        });
        setSelected3D(null);
        setSelectedSourceNodeId(null);
        setUndoStack([]);
        if (overridesRes.data) {
          setOverrides3D({
            overrides: overridesRes.data.overrides || {},
            custom_parts: overridesRes.data.custom_parts || [],
          });
          setHasUnsaved3D(false);
        }
      } catch (err) {
        showToast("error", extractApiError(err, "ไม่สามารถโหลดข้อมูลแผนที่ได้"));
      } finally {
        setIsLoadingData(false);
      }
    },
    [showToast]
  );

  const loadVersionsAndMap = useCallback(
    async (preferredVersionId?: number | null) => {
      setIsLoadingData(true);
      try {
        const verRes = await api.get<MapVersion[]>("/api/admin/map-versions");
        const list = Array.isArray(verRes.data) ? verRes.data : [];
        setVersions(list);

        const targetVer =
          (preferredVersionId
            ? list.find((v) => v.id === preferredVersionId)
            : null) ||
          list.find((v) => v.is_live) ||
          list[0] ||
          null;

        if (targetVer) {
          setActiveVersionId(targetVer.id);
          await loadVersionData(targetVer.id);
        } else {
          setIsLoadingData(false);
        }
      } catch (err) {
        showToast(
          "error",
          extractApiError(err, "ไม่สามารถโหลดรายการเวอร์ชันแผนที่ได้")
        );
        setIsLoadingData(false);
      }
    },
    [loadVersionData, showToast]
  );

  const loadAllMapData = useCallback(async () => {
    await loadVersionsAndMap(activeVersionId);
  }, [loadVersionsAndMap, activeVersionId]);

  useEffect(() => {
    setAuthChecked(true);
    loadVersionsAndMap(null);
  }, [loadVersionsAndMap]);

  // Keep fullscreen sidebar toggle state synced with AdminLayout
  useEffect(() => {
    const onState = (ev: Event) => {
      const custom = ev as CustomEvent<{ hidden?: boolean }>;
      if (typeof custom.detail?.hidden === "boolean") {
        setSidebarHidden(custom.detail.hidden);
      }
    };
    window.addEventListener("admin-sidebar-state", onState);
    return () => window.removeEventListener("admin-sidebar-state", onState);
  }, []);

  const handleToggleFullscreen = () => {
    window.dispatchEvent(new Event("admin-sidebar-toggle"));
  };

  const handleSwitchVersion = async (nextVersionId: number) => {
    if (nextVersionId === activeVersionId) return;
    setActiveVersionId(nextVersionId);
    setLiveWarningDismissed(false);
    await loadVersionData(nextVersionId);
  };

  const handleOpenCloneModal = () => {
    const curr = versions.find((v) => v.id === activeVersionId);
    setCloneName(
      curr ? `ฉบับร่างจาก ${curr.name}` : `ฉบับร่างแผนที่ใหม่`
    );
    setCloneDesc(
      curr ? `คัดลอกจากเวอร์ชัน #${curr.id} เพื่อปรับปรุงก่อนเผยแพร่` : ""
    );
    setCloneModalOpen(true);
  };

  const handleCloneVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVersionId) return;
    setIsVersionBusy(true);
    try {
      const res = await api.post<MapVersion>(
        `/api/admin/map-versions/${activeVersionId}/clone`,
        {
          name: cloneName.trim(),
          description: cloneDesc.trim(),
        }
      );
      setCloneModalOpen(false);
      setLiveWarningDismissed(false);
      await loadVersionsAndMap(res.data.id);
      showToast(
        "success",
        `คัดลอกเป็นฉบับร่าง "${res.data.name}" เรียบร้อยแล้ว แก้ไขได้อย่างปลอดภัยโดยไม่กระทบหน้าผู้ใช้จริง`
      );
    } catch (err) {
      showToast(
        "error",
        extractApiError(err, "ไม่สามารถคัดลอกเวอร์ชันแผนที่ได้")
      );
    } finally {
      setIsVersionBusy(false);
    }
  };

  const handleUpdateVersionMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editVersionModal) return;
    setIsVersionBusy(true);
    try {
      const res = await api.put<MapVersion>(
        `/api/admin/map-versions/${editVersionModal.id}`,
        {
          name: editVersionModal.name.trim(),
          description: editVersionModal.description.trim(),
        }
      );
      setVersions((prev) =>
        prev.map((v) => (v.id === res.data.id ? res.data : v))
      );
      setEditVersionModal(null);
      showToast("success", `อัปเดตชื่อเวอร์ชัน "${res.data.name}" แล้ว`);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถแก้ไขชื่อเวอร์ชันได้"));
    } finally {
      setIsVersionBusy(false);
    }
  };

  const handleDeleteDraftVersion = async (versionId: number) => {
    setIsVersionBusy(true);
    try {
      await api.delete(`/api/admin/map-versions/${versionId}`);
      setEditVersionModal(null);
      await loadVersionsAndMap(null);
      showToast("success", "ลบเวอร์ชันฉบับร่างเรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถลบเวอร์ชันแผนที่ได้"));
    } finally {
      setIsVersionBusy(false);
    }
  };

  const handlePublishVersion = async () => {
    if (!publishConfirmVersion) return;
    setIsVersionBusy(true);
    try {
      const res = await api.post<MapVersion>(
        `/api/admin/map-versions/${publishConfirmVersion.id}/publish`
      );
      setPublishConfirmVersion(null);
      await loadVersionsAndMap(res.data.id);
      showToast(
        "success",
        `ตั้ง "${res.data.name}" เป็นแผนที่ใช้งานจริง (Live) เรียบร้อยแล้ว`
      );
    } catch (err) {
      showToast(
        "error",
        extractApiError(err, "ไม่สามารถเผยแพร่เวอร์ชันแผนที่ได้")
      );
    } finally {
      setIsVersionBusy(false);
    }
  };

  const handleToggleSurveyVisible = (id: number) => {
    setVisibleSurveyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleOpenMergeModal = () => {
    const selected = surveys.filter((s) => visibleSurveyIds.includes(s.id));
    if (selected.length < 2) {
      showToast("error", "กรุณาติ๊กเลือกรอยเดินอย่างน้อย 2 เส้นเพื่อนำมารวมกัน");
      return;
    }
    setMergeName(`รวมรอยเดิน ${selected.length} เส้น`);
    setMergeZone(selected[0]?.zone || "");
    setMergeDeleteOriginals(false);
    setMergeModalOpen(true);
  };

  const handleMergeSurveys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (visibleSurveyIds.length < 2) return;
    setIsSurveyBusy(true);
    try {
      const res = await api.post<SurveyTrack>("/api/admin/survey-tracks/merge", {
        track_ids: visibleSurveyIds,
        name: mergeName.trim(),
        zone: mergeZone.trim(),
        status: "in_progress",
        delete_originals: mergeDeleteOriginals,
      });
      setSurveys((prev) => {
        const filtered = mergeDeleteOriginals
          ? prev.filter((s) => !visibleSurveyIds.includes(s.id))
          : prev;
        return [res.data, ...filtered];
      });
      setVisibleSurveyIds([res.data.id]);
      setMergeModalOpen(false);
      showToast(
        "success",
        `รวมรอยเดินเป็น "${res.data.name}" เรียบร้อยแล้ว`
      );
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถรวมรอยเดินสำรวจได้"));
    } finally {
      setIsSurveyBusy(false);
    }
  };

  const handleSplitSurveyTrack = useCallback(
    async (trackId: number, lat: number, lng: number) => {
      setIsSurveyBusy(true);
      try {
        const res = await api.post<{
          tracks: SurveyTrack[];
          deleted_id: number;
        }>(`/api/admin/survey-tracks/${trackId}/split`, { lat, lng });
        const newParts = Array.isArray(res.data?.tracks) ? res.data.tracks : [];
        setSurveys((prev) => [
          ...newParts,
          ...prev.filter((s) => s.id !== trackId),
        ]);
        setVisibleSurveyIds((prev) => [
          ...prev.filter((id) => id !== trackId),
          ...newParts.map((t) => t.id),
        ]);
        setSplitTrackId(null);
        showToast("success", "ตัดแบ่งรอยเดินออกเป็น 2 ท่อนเรียบร้อยแล้ว");
      } catch (err) {
        showToast(
          "error",
          extractApiError(err, "ไม่สามารถตัดแบ่งรอยเดินได้")
        );
      } finally {
        setIsSurveyBusy(false);
      }
    },
    [showToast]
  );

  const handleModeChange = (nextMode: AdminEditorMode) => {
    setMode(nextMode);
    setSelectedSourceNodeId(null);
    if (nextMode === "customize_3d") {
      setMapViewMode("3d");
      setShowSurveys(false);
      setPanel3DCollapsed(false);
    } else {
      setClickToMove3D(false);
      setClickToPlace3D(false);
    }
  };

  const pushUndoSnapshot = useCallback(() => {
    setUndoStack((prev) => {
      const cloned: Map3DOverridesPayload = {
        overrides: JSON.parse(JSON.stringify(overrides3D.overrides || {})),
        custom_parts: JSON.parse(JSON.stringify(overrides3D.custom_parts || [])),
      };
      const next = [
        ...prev,
        {
          overrides3D: cloned,
          selected3D: selected3D ? { ...selected3D } : null,
          selected3DIsCustom,
          selected3DIsWing,
        },
      ];
      return next.length > 30 ? next.slice(next.length - 30) : next;
    });
  }, [overrides3D, selected3D, selected3DIsCustom, selected3DIsWing]);

  const handleUndo3D = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setOverrides3D(last.overrides3D);
      setSelected3D(last.selected3D);
      setSelected3DIsCustom(last.selected3DIsCustom);
      setSelected3DIsWing(last.selected3DIsWing);
      setHasUnsaved3D(true);
      showToast("success", "ย้อนกลับการปรับแต่งล่าสุดแล้ว (Undo)");
      return prev.slice(0, -1);
    });
  }, [showToast]);

  // Support Ctrl+Z shortcut in Mode 6
  useEffect(() => {
    if (mode !== "customize_3d") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        handleUndo3D();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, handleUndo3D]);

  const handleSelectBuilding3D = useCallback(
    (b: Building3DProps | null) => {
      setClickToMove3D(false);
      setClickToPlace3D(false);
      if (!b) {
        setSelected3D(null);
        return;
      }
      const existingCustom = overrides3D.custom_parts.find((p) => p.id === b.id);
      if (existingCustom) {
        setSelected3DIsCustom(true);
        setSelected3DIsWing(existingCustom.is_wing);
        setSelected3D({
          id: existingCustom.id,
          name: existingCustom.name,
          short_name: existingCustom.short_name,
          center_lat: existingCustom.center_lat,
          center_lng: existingCustom.center_lng,
          width_m: existingCustom.width_m,
          depth_m: existingCustom.depth_m,
          angle_deg: existingCustom.angle_deg,
          height: existingCustom.height,
          base_height: existingCustom.base_height,
          color: existingCustom.color,
          linked_node_id: existingCustom.linked_node_id ?? null,
        });
        return;
      }

      const existingOv = overrides3D.overrides[b.id];
      setSelected3DIsCustom(false);
      setSelected3DIsWing(Boolean(b.is_wing));
      setSelected3D({
        id: b.id,
        name: existingOv?.name ?? b.name,
        short_name: existingOv?.short_name ?? b.short_name,
        center_lat: existingOv?.center_lat ?? b.center_lat,
        center_lng: existingOv?.center_lng ?? b.center_lng,
        width_m: existingOv?.width_m ?? b.width_m ?? 28,
        depth_m: existingOv?.depth_m ?? b.depth_m ?? 20,
        angle_deg: existingOv?.angle_deg ?? b.angle_deg ?? -24,
        height: existingOv?.height ?? b.height ?? 12,
        base_height: existingOv?.base_height ?? b.base_height ?? 0,
        color: existingOv?.color ?? b.color ?? "#E2E8F0",
        linked_node_id: existingOv?.linked_node_id ?? b.linked_node_id ?? null,
      });
    },
    [overrides3D]
  );

  const updateSelected3DField = useCallback(
    (
      patch: Partial<Building3DOverride>,
      nextIsWing?: boolean,
      recordUndo = false
    ) => {
      if (recordUndo) {
        pushUndoSnapshot();
      }
      setSelected3D((prev) => {
        if (!prev) return prev;
        const updated: Building3DOverride = { ...prev, ...patch };
        setHasUnsaved3D(true);
        setOverrides3D((curr) => {
          const idx = curr.custom_parts.findIndex((p) => p.id === updated.id);
          if (idx >= 0) {
            const nextParts = [...curr.custom_parts];
            nextParts[idx] = {
              ...nextParts[idx],
              name: updated.name || nextParts[idx].name,
              short_name: updated.short_name ?? nextParts[idx].short_name,
              is_wing: nextIsWing ?? nextParts[idx].is_wing,
              center_lat: updated.center_lat,
              center_lng: updated.center_lng,
              width_m: updated.width_m,
              depth_m: updated.depth_m,
              angle_deg: updated.angle_deg,
              height: updated.height,
              base_height: updated.base_height,
              color: updated.color,
              linked_node_id: updated.linked_node_id ?? null,
            };
            return { ...curr, custom_parts: nextParts };
          }
          return {
            ...curr,
            overrides: {
              ...curr.overrides,
              [updated.id]: updated,
            },
          };
        });
        return updated;
      });
      if (nextIsWing !== undefined) {
        setSelected3DIsWing(nextIsWing);
      }
    },
    [pushUndoSnapshot]
  );

  const nudgeSelected3D = useCallback(
    (dNorthMeters: number, dEastMeters: number) => {
      if (!selected3D) return;
      const cosLat = Math.cos((selected3D.center_lat * Math.PI) / 180);
      const nextLat = Number(
        (selected3D.center_lat + dNorthMeters / 111320).toFixed(6)
      );
      const nextLng = Number(
        (selected3D.center_lng + dEastMeters / (111320 * cosLat)).toFixed(6)
      );
      updateSelected3DField({ center_lat: nextLat, center_lng: nextLng }, undefined, true);
    },
    [selected3D, updateSelected3DField]
  );

  const handleAddBlock3D = useCallback(
    (asWing = false, customLat?: number, customLng?: number) => {
      pushUndoSnapshot();
      const baseLat =
        customLat ??
        (asWing && selected3D
          ? selected3D.center_lat + 0.0001
          : mapViewportCenter[0]);
      const baseLng =
        customLng ??
        (asWing && selected3D
          ? selected3D.center_lng + 0.0001
          : mapViewportCenter[1]);
      const newPart: Custom3DPart = {
        id: `custom-3d-${Date.now()}`,
        parent_id: asWing && selected3D ? selected3D.id : undefined,
        name: asWing
          ? `ส่วนยื่น ${selected3D?.short_name || selected3D?.name || "อาคาร"}`
          : "บล็อกอาคาร 3D ใหม่",
        short_name: asWing ? "" : "อาคารใหม่",
        is_wing: asWing,
        center_lat: Number(baseLat.toFixed(6)),
        center_lng: Number(baseLng.toFixed(6)),
        width_m: asWing ? 18 : 24,
        depth_m: asWing ? 12 : 18,
        angle_deg: selected3D?.angle_deg ?? -24,
        height: asWing
          ? Math.max(8, Math.round((selected3D?.height ?? 16) * 0.65))
          : 14,
        base_height: 0,
        color: selected3D?.color ?? "#EAB308",
        linked_node_id: asWing ? selected3D?.linked_node_id ?? null : null,
      };
      setOverrides3D((curr) => ({
        ...curr,
        custom_parts: [...curr.custom_parts, newPart],
      }));
      setSelected3DIsCustom(true);
      setSelected3DIsWing(newPart.is_wing);
      setSelected3D({
        id: newPart.id,
        name: newPart.name,
        short_name: newPart.short_name,
        center_lat: newPart.center_lat,
        center_lng: newPart.center_lng,
        width_m: newPart.width_m,
        depth_m: newPart.depth_m,
        angle_deg: newPart.angle_deg,
        height: newPart.height,
        base_height: newPart.base_height,
        color: newPart.color,
        linked_node_id: newPart.linked_node_id ?? null,
      });
      setHasUnsaved3D(true);
      showToast(
        "success",
        asWing
          ? "เพิ่มปีกยื่น 3D แล้ว ลากจุดจับเพื่อจัดวางได้เลย"
          : "เพิ่มบล็อก 3D ใหม่แล้ว ลากย้าย/ยืด-หดบนแผนที่ได้ทันที"
      );
    },
    [selected3D, mapViewportCenter, pushUndoSnapshot, showToast]
  );

  const handleDuplicateSelected3D = useCallback(() => {
    if (!selected3D) return;
    pushUndoSnapshot();
    const cosLat = Math.cos((selected3D.center_lat * Math.PI) / 180);
    const rad = (selected3D.angle_deg * Math.PI) / 180;
    const shiftM = Math.min(18, Math.max(8, selected3D.width_m * 0.45));
    const dx = Math.cos(rad) * shiftM;
    const dy = Math.sin(rad) * shiftM;
    const nextLat = Number((selected3D.center_lat + dy / 111320).toFixed(6));
    const nextLng = Number(
      (selected3D.center_lng + dx / (111320 * cosLat)).toFixed(6)
    );

    const dupPart: Custom3DPart = {
      id: `custom-3d-${Date.now()}`,
      parent_id: selected3D.id,
      name: `${selected3D.name || selected3D.short_name || "บล็อก"} (คัดลอก)`,
      short_name: "",
      is_wing: true,
      center_lat: nextLat,
      center_lng: nextLng,
      width_m: selected3D.width_m,
      depth_m: selected3D.depth_m,
      angle_deg: selected3D.angle_deg,
      height: selected3D.height,
      base_height: selected3D.base_height,
      color: selected3D.color,
      linked_node_id: selected3D.linked_node_id ?? null,
    };

    setOverrides3D((curr) => ({
      ...curr,
      custom_parts: [...curr.custom_parts, dupPart],
    }));
    setSelected3DIsCustom(true);
    setSelected3DIsWing(true);
    setSelected3D({
      id: dupPart.id,
      name: dupPart.name,
      short_name: dupPart.short_name,
      center_lat: dupPart.center_lat,
      center_lng: dupPart.center_lng,
      width_m: dupPart.width_m,
      depth_m: dupPart.depth_m,
      angle_deg: dupPart.angle_deg,
      height: dupPart.height,
      base_height: dupPart.base_height,
      color: dupPart.color,
      linked_node_id: dupPart.linked_node_id ?? null,
    });
    setHasUnsaved3D(true);
    showToast("success", "คัดลอกบล็อก 3D เรียบร้อยแล้ว ลากต่อเป็นตึก L/U ได้เลย");
  }, [selected3D, pushUndoSnapshot, showToast]);

  const handleDeleteSelected3D = useCallback(() => {
    if (!selected3D) return;
    pushUndoSnapshot();
    if (selected3DIsCustom) {
      setOverrides3D((curr) => ({
        ...curr,
        custom_parts: curr.custom_parts.filter((p) => p.id !== selected3D.id),
      }));
      setSelected3D(null);
      setHasUnsaved3D(true);
      showToast("success", "ลบบล็อก 3D ที่สร้างเองแล้ว (กดบันทึก 3D เพื่อยืนยัน)");
      return;
    }
    setOverrides3D((curr) => ({
      ...curr,
      overrides: {
        ...curr.overrides,
        [selected3D.id]: { ...selected3D, hidden: true },
      },
    }));
    setSelected3D(null);
    setHasUnsaved3D(true);
    showToast("success", "ลบบล็อกนี้ออกจากแผนที่ 3D แล้ว (กดบันทึก 3D หรือ Undo ได้)");
  }, [selected3D, selected3DIsCustom, pushUndoSnapshot, showToast]);

  const handleResetSelected3D = useCallback(() => {
    if (!selected3D || selected3DIsCustom) return;
    pushUndoSnapshot();
    setOverrides3D((curr) => {
      const nextOv = { ...curr.overrides };
      delete nextOv[selected3D.id];
      return { ...curr, overrides: nextOv };
    });
    setSelected3D(null);
    setHasUnsaved3D(true);
    showToast("success", "รีเซ็ตทรงตึกกลับค่าตั้งต้นแล้ว (กดบันทึก 3D เพื่อยืนยัน)");
  }, [selected3D, selected3DIsCustom, pushUndoSnapshot, showToast]);

  const handleSave3DOverrides = useCallback(async () => {
    setIsSaving3D(true);
    try {
      const res = await api.put<Map3DOverridesPayload>(
        "/api/admin/map-3d-overrides",
        overrides3D,
        {
          params: activeVersionId ? { version_id: activeVersionId } : undefined,
        }
      );
      setOverrides3D({
        overrides: res.data.overrides || {},
        custom_parts: res.data.custom_parts || [],
      });
      setHasUnsaved3D(false);
      showToast(
        "success",
        "บันทึกการปรับแต่งโมเดล 3D ในเวอร์ชันนี้เรียบร้อยแล้ว"
      );
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกโมเดล 3D ได้"));
    } finally {
      setIsSaving3D(false);
    }
  }, [overrides3D, activeVersionId, showToast]);

  // Mode 1: Click empty map -> Open modal to create a new Node, OR place/move 3D model in customize_3d mode
  const handleMapClick = (lat: number, lng: number) => {
    if (mode === "customize_3d") {
      if (clickToPlace3D) {
        setClickToPlace3D(false);
        handleAddBlock3D(false, lat, lng);
        return;
      }
      if (clickToMove3D && selected3D) {
        updateSelected3DField(
          {
            center_lat: Number(lat.toFixed(6)),
            center_lng: Number(lng.toFixed(6)),
          },
          undefined,
          true
        );
        setClickToMove3D(false);
        showToast("success", "ย้ายตำแหน่งโมเดล 3D ไปยังจุดที่คลิกแล้ว");
      }
      return;
    }
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
          is_covered: edgeCovered,
          is_indoor_passthrough: edgeIndoor,
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

  // Click existing edge -> open edit modal or delete
  const handleEdgeClick = async (edge: MapEdge) => {
    if (mode === "toggle_edge") {
      setEdgeModal({
        id: edge.id,
        from_node: edge.from_node,
        to_node: edge.to_node,
        distance_m: edge.distance_m,
        is_active: edge.is_active,
        is_wheelchair_friendly: edge.is_wheelchair_friendly,
        is_covered: Boolean(edge.is_covered),
        is_indoor_passthrough: Boolean(edge.is_indoor_passthrough),
        instruction: edge.instruction || "",
        closure_reason: edge.closure_reason || "",
      });
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

  const handleSaveEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edgeModal) return;
    setIsSavingEdge(true);
    try {
      const res = await api.put<MapEdge>(`/api/admin/edges/${edgeModal.id}`, {
        is_active: edgeModal.is_active,
        is_wheelchair_friendly: edgeModal.is_wheelchair_friendly,
        is_covered: edgeModal.is_covered,
        is_indoor_passthrough: edgeModal.is_indoor_passthrough,
        instruction: edgeModal.instruction.trim(),
        closure_reason: edgeModal.is_active ? "" : edgeModal.closure_reason.trim(),
      });
      setEdges((prev) =>
        prev.map((item) => (item.id === edgeModal.id ? res.data : item))
      );
      setEdgeModal(null);
      showToast(
        "success",
        res.data.is_active
          ? `อัปเดตและเปิดใช้งานเส้นทาง #${res.data.id} เรียบร้อยแล้ว`
          : `บันทึกปิดเส้นทาง #${res.data.id} ชั่วคราวเรียบร้อยแล้ว`
      );
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกข้อมูลเส้นทางได้"));
    } finally {
      setIsSavingEdge(false);
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
        const edgesRes = await api.get<MapEdge[]>("/api/admin/edges", {
          params: activeVersionId ? { version_id: activeVersionId } : undefined,
        });
        setEdges(Array.isArray(edgesRes.data) ? edgesRes.data : []);
        showToast("success", `อัปเดตข้อมูลจุด #${res.data.id} เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<MapNode>("/api/admin/nodes", payload, {
          params: activeVersionId ? { version_id: activeVersionId } : undefined,
        });
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
      <div className="flex-1 min-h-0 h-full bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
      </div>
    );
  }

  const buildingCount = nodes.filter((n) => n.is_building).length;
  const closedEdgeCount = edges.filter((e) => !e.is_active).length;
  const activeVersion =
    versions.find((v) => v.id === activeVersionId) ?? versions[0] ?? null;

  const modeHint: Record<AdminEditorMode, string> = {
    add_node:
      "คลิกพื้นที่ว่างบนแผนที่เพื่อเพิ่มตึก/จุดแยกใหม่ หรือคลิกจุดเดิมเพื่อแก้ไขข้อมูล",
    connect_edge: selectedSourceNodeId
      ? `เลือกจุดเริ่มต้น #${selectedSourceNodeId} แล้ว — คลิกจุดที่ 2 เพื่อเชื่อมเส้นทาง (คำนวณระยะทาง PostGIS อัตโนมัติ)`
      : "คลิกจุดที่ 1 จากนั้นคลิกจุดที่ 2 เพื่อสร้างเส้นเชื่อมทางเดิน",
    toggle_edge:
      "คลิกที่เส้นทางใดก็ได้เพื่อเปิดหน้าต่างแก้ไขคุณสมบัติเส้นทาง (เปิด/ปิดปรับปรุง, ระบุเหตุผล, ทางมีหลังคา, เดินทะลุอาคาร)",
    delete: "คลิกที่จุด (Node) หรือเส้นเชื่อม (Edge) ที่ต้องการลบออกจากแผนที่",
    customize_3d: clickToPlace3D
      ? "คลิกตำแหน่งใดก็ได้บนแผนที่ 3D เพื่อวางบล็อก 3D ใหม่ตรงจุดนั้น"
      : clickToMove3D
      ? "คลิกตำแหน่งใหม่บนแผนที่ 3D เพื่อย้ายบล็อกที่เลือกไปวางตรงจุดนั้น"
      : "คลิกเลือกบล็อก 3D แล้วลากจุดสีฟ้า (ย้าย), จุดสี่เหลี่ยมขอบข้าง (ยืด-หด), หรือจุดสีเขียว (หมุน) ได้อิสระบนแผนที่",
  };

  const modeLabel: Record<AdminEditorMode, string> = {
    add_node: "เพิ่ม/แก้ไขจุด",
    connect_edge: "เชื่อมเส้นทาง",
    toggle_edge: "เปิด/ปิดเส้นทาง",
    delete: "ลบจุด/เส้น",
    customize_3d: "โมเดล 3D",
  };

  const visibleSurveys = surveys.filter((s) => visibleSurveyIds.includes(s.id));
  const splittingTrack =
    splitTrackId !== null
      ? surveys.find((s) => s.id === splitTrackId) ?? null
      : null;

  return (
    <div className="flex-1 min-h-0 h-full w-full relative overflow-hidden bg-[#E6EDF4]">
      {/* 100% Full-Viewport Map Canvas */}
      <div className="absolute inset-0">
        {mapViewMode === "3d" ? (
          <Admin3DMapEditor
            mapViewMode={mapViewMode}
            onChangeMapViewMode={setMapViewMode}
            mode={mode}
            nodes={nodes}
            edges={edges}
            surveys={visibleSurveys}
            showSurveys={showSurveys}
            selectedSourceNodeId={selectedSourceNodeId}
            overrides3D={overrides3D}
            selectedBuilding3DId={selected3D?.id ?? null}
            selected3D={selected3D}
            showSatelliteUnderlay={showSatelliteUnderlay}
            buildingOpacity={buildingOpacity}
            onSelectBuilding3D={handleSelectBuilding3D}
            onBeginTransform3D={pushUndoSnapshot}
            onLiveTransform3D={(patch) => updateSelected3DField(patch)}
            onMapCenterChange={(lat, lng) => setMapViewportCenter([lat, lng])}
            onMapClick={handleMapClick}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            splitTrackId={splitTrackId}
            onSplitTrackClick={handleSplitSurveyTrack}
            onRefresh={loadAllMapData}
            isRefreshing={isLoadingData}
          />
        ) : (
          <AdminMapEditor
            mapViewMode={mapViewMode}
            onChangeMapViewMode={setMapViewMode}
            mode={mode}
            nodes={nodes}
            edges={edges}
            surveys={visibleSurveys}
            showSurveys={showSurveys}
            selectedSourceNodeId={selectedSourceNodeId}
            onMapClick={handleMapClick}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            splitTrackId={splitTrackId}
            onSplitTrackClick={handleSplitSurveyTrack}
            onRefresh={loadAllMapData}
            isRefreshing={isLoadingData}
          />
        )}
      </div>

      {/* Compact Single-Row Floating Top Bar */}
      <div className="absolute top-3 left-3 right-3 z-[450] pointer-events-none flex flex-col gap-1.5">
        <div className="pointer-events-auto bg-white/95 backdrop-blur-md border border-slate-200 shadow-lg rounded-2xl px-2.5 py-1.5 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          {/* Left: Map Version Dropdown + Clone / Edit / Publish / Preview */}
          <div className="flex items-center gap-1.5 shrink-0">
            {activeVersion && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold shrink-0 ${
                  activeVersion.is_live
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                    : "bg-amber-100 text-amber-800 border border-amber-200"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeVersion.is_live ? "bg-emerald-600" : "bg-amber-500"
                  }`}
                />
                <span>{activeVersion.is_live ? "ใช้งานจริง" : "ฉบับร่าง"}</span>
              </span>
            )}

            <select
              aria-label="เลือกเวอร์ชันแผนที่"
              value={activeVersionId ? String(activeVersionId) : ""}
              onChange={(e) => handleSwitchVersion(Number(e.target.value))}
              disabled={isVersionBusy || versions.length === 0}
              className="h-9 max-w-[200px] sm:max-w-[230px] px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-[#0F172A] focus:outline-none focus:border-[#0F766E] cursor-pointer"
            >
              {versions.map((v) => (
                <option key={`ver-${v.id}`} value={String(v.id)}>
                  {v.is_live ? "[LIVE] " : "[DRAFT] "}
                  {v.name} ({v.node_count} จุด)
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleOpenCloneModal}
              disabled={isVersionBusy || !activeVersion}
              title="คัดลอกเวอร์ชันนี้เป็นฉบับร่าง (Copy Draft)"
              aria-label="คัดลอกเพื่อแก้"
              className="h-9 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-teal-50 hover:border-teal-300 text-slate-700 hover:text-[#0F766E] text-xs font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">คัดลอก</span>
            </button>

            {activeVersion && (
              <button
                type="button"
                onClick={() =>
                  setEditVersionModal({
                    id: activeVersion.id,
                    name: activeVersion.name,
                    description: activeVersion.description || "",
                    is_live: activeVersion.is_live,
                  })
                }
                disabled={isVersionBusy}
                title="แก้ไขชื่อ / จัดการเวอร์ชันนี้"
                aria-label="แก้ไขชื่อเวอร์ชัน"
                className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}

            {activeVersion && !activeVersion.is_live && (
              <button
                type="button"
                onClick={() => setPublishConfirmVersion(activeVersion)}
                disabled={isVersionBusy}
                title="ตั้งเวอร์ชันฉบับร่างนี้เป็นแผนที่ใช้งานจริง (Publish Live)"
                className="h-9 px-2.5 rounded-xl bg-[#047857] hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ตั้งเป็นแผนที่จริง</span>
              </button>
            )}

            {activeVersion && (
              <a
                href={`/?preview_version_id=${activeVersion.id}`}
                target="_blank"
                rel="noopener noreferrer"
                title="ดูตัวอย่างหน้าผู้ใช้สำหรับเวอร์ชันนี้ (Preview)"
                aria-label="ดูตัวอย่างหน้าผู้ใช้"
                className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-300 text-slate-600 hover:text-sky-700 flex items-center justify-center shrink-0 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="h-5 w-px bg-slate-200 shrink-0" />

          {/* Center: Compact 6-Mode Icon Strip + [ ! ] Info Popover */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => handleModeChange("add_node")}
              title="1. เพิ่ม/แก้ไขตึกและจุด"
              aria-label="1. เพิ่ม/แก้ไขตึกและจุด"
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                mode === "add_node"
                  ? "bg-[#0F766E] text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              {mode === "add_node" && (
                <span className="hidden xl:inline">{modeLabel.add_node}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("connect_edge")}
              title="2. เชื่อมเส้นทาง"
              aria-label="2. เชื่อมเส้นทาง"
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                mode === "connect_edge"
                  ? "bg-[#0F766E] text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <GitBranch className="w-4 h-4 shrink-0" />
              {mode === "connect_edge" && (
                <span className="hidden xl:inline">
                  {modeLabel.connect_edge}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("toggle_edge")}
              title="3. เปิด/ปิด และแก้ไขคุณสมบัติเส้นทาง"
              aria-label="3. เปิด/ปิดเส้นทาง"
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                mode === "toggle_edge"
                  ? "bg-[#1D4ED8] text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <ToggleLeft className="w-4 h-4 shrink-0" />
              {mode === "toggle_edge" && (
                <span className="hidden xl:inline">{modeLabel.toggle_edge}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleModeChange("delete")}
              title="4. ลบจุด / เส้นเชื่อม"
              aria-label="4. ลบจุด / เส้นเชื่อม"
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                mode === "delete"
                  ? "bg-[#BE123C] text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              {mode === "delete" && (
                <span className="hidden xl:inline">{modeLabel.delete}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowSurveys((prev) => !prev)}
              title={`5. แสดง Survey Tracks (${surveys.length})`}
              aria-label="5. แสดง Survey Tracks"
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                showSurveys
                  ? "bg-orange-500 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Route className="w-4 h-4 shrink-0" />
              {showSurveys && (
                <span className="hidden xl:inline">
                  Survey ({surveys.length})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (mode === "customize_3d") {
                  setPanel3DCollapsed((prev) => !prev);
                } else {
                  handleModeChange("customize_3d");
                }
              }}
              title="6. ปรับแต่ง/ยื่นโมเดล 3D"
              aria-label="6. ปรับแต่ง/ยื่นโมเดล 3D"
              className={`h-9 px-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                mode === "customize_3d"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Box className="w-4 h-4 shrink-0" />
              {mode === "customize_3d" && (
                <span className="hidden xl:inline">
                  {modeLabel.customize_3d}
                  {hasUnsaved3D ? " *" : ""}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setModeInfoOpen((prev) => !prev)}
              title="คำอธิบายวิธีใช้งานโหมดนี้และสถิติแผนที่"
              aria-label="วิธีใช้งานโหมดนี้"
              aria-expanded={modeInfoOpen}
              className={`w-9 h-9 rounded-xl border text-xs font-bold flex items-center justify-center transition-colors cursor-pointer ${
                modeInfoOpen
                  ? "bg-[#0F766E] border-[#0F766E] text-white"
                  : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
              }`}
            >
              <Info className="w-4 h-4" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 shrink-0" />

          {/* Right: Fullscreen / Hide Left Admin Sidebar */}
          <button
            type="button"
            onClick={handleToggleFullscreen}
            title={
              sidebarHidden
                ? "แสดงแถบเมนูซ้าย (ออกจากโหมดเต็มจอ)"
                : "ซ่อนแถบเมนูซ้ายเพื่อดูแผนที่เต็มจอ 100%"
            }
            aria-label={sidebarHidden ? "แสดงแถบเมนูซ้าย" : "เต็มจอ"}
            className={`h-9 px-2.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
              sidebarHidden
                ? "bg-[#0F766E] border-[#0F766E] text-white"
                : "border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
            }`}
          >
            {sidebarHidden ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
            <span className="hidden 2xl:inline">
              {sidebarHidden ? "แสดงเมนู" : "เต็มจอ"}
            </span>
          </button>
        </div>

        {/* Live Version Safety Hint Pill (compact, dismissible) */}
        {activeVersion?.is_live && !liveWarningDismissed && (
          <div className="pointer-events-auto self-start bg-amber-50/95 backdrop-blur border border-amber-200 shadow-sm rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="font-medium">
              กำลังแก้ไขเวอร์ชันที่ใช้งานจริง แนะนำให้กดคัดลอกเป็นฉบับร่างก่อนแก้ไขเพื่อความปลอดภัย
            </span>
            <button
              type="button"
              onClick={handleOpenCloneModal}
              className="px-2 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              คัดลอกเป็นฉบับร่าง
            </button>
            <button
              type="button"
              onClick={() => setLiveWarningDismissed(true)}
              aria-label="ซ่อนคำเตือน"
              className="w-5 h-5 rounded hover:bg-amber-200/70 text-amber-800 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Mode Usage Info Popover (triggered by [ ! ] button) */}
        {modeInfoOpen && (
          <div className="pointer-events-auto self-center max-w-md bg-white/98 backdrop-blur border border-slate-200 shadow-xl rounded-2xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[#0F172A]">
                โหมดปัจจุบัน: {modeLabel[mode]}
              </span>
              <button
                type="button"
                onClick={() => setModeInfoOpen(false)}
                aria-label="ปิดคำอธิบาย"
                className="w-6 h-6 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-slate-600 leading-relaxed">{modeHint[mode]}</p>
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-500">
              <span>{nodes.length} จุด ({buildingCount} อาคาร)</span>
              <span>•</span>
              <span>{edges.length} เส้นเชื่อม ({closedEdgeCount} ปิดชั่วคราว)</span>
              <span>•</span>
              <span>{surveys.length} รอยเดินสำรวจ</span>
            </div>
          </div>
        )}

        {/* Split Track Mode Active Banner */}
        {splittingTrack && (
          <div className="pointer-events-auto self-center bg-sky-600 text-white shadow-lg rounded-xl px-3.5 py-2 flex items-center gap-2.5 text-xs font-bold">
            <Scissors className="w-4 h-4 shrink-0" />
            <span>
              โหมดตัดแบ่ง: คลิกจุดกลางเส้น &ldquo;{splittingTrack.name}&rdquo; บนแผนที่เพื่อแบ่งเป็น 2 ท่อน
            </span>
            <button
              type="button"
              onClick={() => setSplitTrackId(null)}
              className="px-2 py-0.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] cursor-pointer"
            >
              ยกเลิก
            </button>
          </div>
        )}

        {/* Compact Floating Options Bar for Mode 2 (Connect Edge) */}
        {mode === "connect_edge" && (
          <div className="pointer-events-auto self-start bg-white/95 backdrop-blur border border-slate-200 shadow-md rounded-xl px-3 py-2 flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-[#0F766E]">
              {selectedSourceNodeId
                ? `ต้นทาง #${selectedSourceNodeId} → คลิกจุดปลายทาง`
                : "คลิกจุดที่ 1 → จุดที่ 2"}
            </span>
            <input
              type="text"
              value={edgeInstruction}
              onChange={(e) => setEdgeInstruction(e.target.value)}
              placeholder="คำอธิบายทางเดิน (ไม่บังคับ)"
              className="h-8 px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-[#0F172A] w-44 focus:outline-none focus:border-[#0F766E]"
            />
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={edgeWheelchair}
                onChange={(e) => setEdgeWheelchair(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#0F766E]"
              />
              <Accessibility className="w-3.5 h-3.5 text-[#0F766E]" />
              <span>รถเข็น</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={edgeCovered}
                onChange={(e) => setEdgeCovered(e.target.checked)}
                className="w-3.5 h-3.5 accent-sky-600"
              />
              <Umbrella className="w-3.5 h-3.5 text-sky-600" />
              <span>มีหลังคา</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={edgeIndoor}
                onChange={(e) => setEdgeIndoor(e.target.checked)}
                className="w-3.5 h-3.5 accent-violet-600"
              />
              <Building2 className="w-3.5 h-3.5 text-violet-600" />
              <span>ทะลุอาคาร</span>
            </label>
          </div>
        )}
      </div>

      {/* Re-open button when Mode 6 (3D Studio) panel is collapsed */}
      {mode === "customize_3d" && panel3DCollapsed && (
        <button
          type="button"
          onClick={() => setPanel3DCollapsed(false)}
          className="absolute bottom-4 right-3 z-[430] h-10 px-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-lg inline-flex items-center gap-2 cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>เปิดแผง 3D Studio{hasUnsaved3D ? " *" : ""}</span>
        </button>
      )}

      {/* Floating Collapsible 3D Building Customizer Panel (Mode 6) */}
      {mode === "customize_3d" && !panel3DCollapsed && (
        <aside className="absolute top-[70px] right-14 sm:right-14 bottom-3 z-[430] w-80 sm:w-96 max-w-[calc(100vw-24px)] rounded-2xl bg-white/97 backdrop-blur-md border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/90">
            <div className="flex items-center gap-2 min-w-0">
              <Box className="w-4 h-4 text-sky-600 shrink-0" />
              <h2 className="font-heading text-sm font-bold text-[#0F172A] truncate">
                3D Studio{hasUnsaved3D ? " *" : ""}
              </h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleUndo3D}
                disabled={undoStack.length === 0}
                title="เลิกทำ (Undo / Ctrl+Z)"
                className="h-8 px-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>เลิกทำ</span>
              </button>
              <button
                type="button"
                onClick={handleSave3DOverrides}
                disabled={isSaving3D}
                className="h-8 px-2.5 rounded-lg bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                {isSaving3D ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>บันทึก 3D</span>
              </button>
              <button
                type="button"
                onClick={() => setPanel3DCollapsed(true)}
                title="พับแผง 3D Studio"
                aria-label="พับแผง 3D Studio"
                className="w-8 h-8 rounded-lg hover:bg-slate-200/70 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Rooftop Alignment Helper: Satellite Underlay Toggle + 3D Block Opacity */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    ตัวช่วยจัดวางให้ตรงพื้นที่จริง
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setShowSatelliteUnderlay((prev) => {
                        const next = !prev;
                        if (next && buildingOpacity > 0.75) {
                          setBuildingOpacity(0.55);
                        } else if (!next && buildingOpacity < 0.75) {
                          setBuildingOpacity(0.92);
                        }
                        return next;
                      })
                    }
                    className={`min-h-[32px] px-2.5 rounded-lg border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      showSatelliteUnderlay
                        ? "bg-[#0F766E] border-[#0F766E] text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-teal-50"
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>พื้นหลังดาวเทียม</span>
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                    <span>ความทึบแสงบล็อก 3D (สำหรับทาบหลังคา)</span>
                    <span className="tabular-nums font-bold text-slate-800">
                      {Math.round(buildingOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={Math.round(buildingOpacity * 100)}
                    onChange={(e) =>
                      setBuildingOpacity(Number(e.target.value) / 100)
                    }
                    className="w-full accent-[#0F766E] cursor-pointer"
                  />
                </div>
              </div>

              {/* Add / Click-to-Place / Add Wing Controls */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleAddBlock3D(false)}
                  className="min-h-[38px] px-2.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-[#0F766E] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>เพิ่มบล็อก 3D ใหม่</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClickToMove3D(false);
                    setClickToPlace3D((prev) => !prev);
                  }}
                  className={`min-h-[38px] px-2.5 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    clickToPlace3D
                      ? "bg-amber-500 border-amber-600 text-white"
                      : "border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800"
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>{clickToPlace3D ? "คลิกจุดวางบนแมพ..." : "คลิกวางบนแผนที่"}</span>
                </button>
              </div>

              {!selected3D ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center space-y-2">
                  <Box className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-700">
                    คลิกเลือกบล็อกบนแผนที่ 3D
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    คลิกเลือกอาคารใดก็ได้เพื่อแสดงจุดจับลากย้าย (สีฟ้า), จุดยืด-หด 4 ด้าน, จุดหมุน (สีเขียว) หรือคัดลอกต่อเป็นตึกรูปตัว L/U และทางเชื่อมลอยฟ้า
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Selected Building Title, Wing Checkbox, Duplicate & Skybridge Quick Actions */}
                  <div className="rounded-xl bg-sky-50/70 border border-sky-200 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-sky-700">
                        {selected3DIsCustom
                          ? "บล็อก 3D ที่สร้างเอง"
                          : "บล็อก 3D ที่เลือก"}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 truncate max-w-[140px]">
                        {selected3D.id}
                      </span>
                    </div>

                    <input
                      type="text"
                      value={selected3D.short_name ?? ""}
                      onChange={(e) =>
                        updateSelected3DField({
                          short_name: e.target.value,
                          name: e.target.value || selected3D.name,
                        })
                      }
                      placeholder="ชื่อป้ายบนแผนที่ (เว้นว่างถ้าเป็นปีกยื่น)"
                      className="w-full min-h-[38px] px-3 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-[#0F172A] focus:outline-none focus:border-sky-500"
                    />

                    {/* Bind to existing Building Node ID */}
                    <div className="space-y-1">
                      <label
                        htmlFor="link-node-select"
                        className="flex items-center gap-1 text-[11px] font-bold text-slate-600"
                      >
                        <Link2 className="w-3.5 h-3.5 text-[#0F766E]" />
                        <span>ผูกกับอาคารในระบบนำทาง (node_id)</span>
                      </label>
                      <select
                        id="link-node-select"
                        value={
                          selected3D.linked_node_id
                            ? String(selected3D.linked_node_id)
                            : ""
                        }
                        onChange={(e) => {
                          const val = e.target.value
                            ? Number(e.target.value)
                            : null;
                          updateSelected3DField(
                            { linked_node_id: val },
                            undefined,
                            true
                          );
                        }}
                        className="w-full min-h-[36px] px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-sky-500"
                      >
                        <option value="">-- จับคู่อัตโนมัติตามพิกัด --</option>
                        {nodes
                          .filter((n) => n.is_building)
                          .map((b) => (
                            <option key={`link-bldg-${b.id}`} value={String(b.id)}>
                              #{b.id} {b.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {selected3DIsCustom && (
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected3DIsWing}
                          onChange={(e) =>
                            updateSelected3DField({}, e.target.checked, true)
                          }
                          className="w-4 h-4 accent-sky-600"
                        />
                        <span>เป็นส่วนยื่นของอาคาร (ไม่แสดงป้ายชื่อซ้ำ)</span>
                      </label>
                    )}

                    {/* Quick Duplicate / Add Wing / Skybridge */}
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={handleDuplicateSelected3D}
                        className="min-h-[34px] px-2 rounded-lg bg-white border border-sky-200 hover:bg-sky-100 text-sky-800 text-[11px] font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                        <span>คัดลอก</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddBlock3D(true)}
                        className="min-h-[34px] px-2 rounded-lg bg-white border border-sky-200 hover:bg-sky-100 text-sky-800 text-[11px] font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <CopyPlus className="w-3.5 h-3.5 shrink-0" />
                        <span>เพิ่มปีกยื่น</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelected3DField(
                            { base_height: 4, height: 8 },
                            undefined,
                            true
                          )
                        }
                        title="ตั้งค่าระดับฐานยกลอยจากพื้น 4 ม. สำหรับทำทางเชื่อมลอยฟ้า"
                        className="min-h-[34px] px-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-50 text-amber-800 text-[11px] font-bold inline-flex items-center justify-center cursor-pointer"
                      >
                        <span>ทางเชื่อมลอยฟ้า</span>
                      </button>
                    </div>
                  </div>

                  {/* Width (Stretch X) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>ความกว้าง (ยืด-หดซ้ายขวา)</span>
                      <span className="tabular-nums text-sky-700">
                        {selected3D.width_m} ม.
                      </span>
                    </div>
                    <input
                      type="range"
                      min={3}
                      max={160}
                      step={0.5}
                      value={selected3D.width_m}
                      onPointerDown={pushUndoSnapshot}
                      onChange={(e) =>
                        updateSelected3DField({ width_m: Number(e.target.value) })
                      }
                      className="w-full accent-sky-600 cursor-pointer"
                    />
                  </div>

                  {/* Depth (Stretch Y / Extrude Wing) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>ความยาว / ลึก (ยื่นหน้า-หลัง)</span>
                      <span className="tabular-nums text-sky-700">
                        {selected3D.depth_m} ม.
                      </span>
                    </div>
                    <input
                      type="range"
                      min={3}
                      max={160}
                      step={0.5}
                      value={selected3D.depth_m}
                      onPointerDown={pushUndoSnapshot}
                      onChange={(e) =>
                        updateSelected3DField({ depth_m: Number(e.target.value) })
                      }
                      className="w-full accent-sky-600 cursor-pointer"
                    />
                  </div>

                  {/* Height & Base Height */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>ความสูง</span>
                        <span className="tabular-nums text-sky-700">
                          {Math.round(selected3D.height)} ม.
                        </span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={60}
                        step={1}
                        value={Math.round(selected3D.height)}
                        onPointerDown={pushUndoSnapshot}
                        onChange={(e) =>
                          updateSelected3DField({ height: Number(e.target.value) })
                        }
                        className="w-full accent-sky-600 cursor-pointer"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>ระดับฐาน</span>
                        <span className="tabular-nums text-sky-700">
                          {Math.round(selected3D.base_height)} ม.
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={45}
                        step={1}
                        value={Math.round(selected3D.base_height)}
                        onPointerDown={pushUndoSnapshot}
                        onChange={(e) =>
                          updateSelected3DField({
                            base_height: Number(e.target.value),
                          })
                        }
                        className="w-full accent-sky-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Rotation Angle */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>มุมหมุนอาคาร</span>
                      <span className="tabular-nums text-sky-700">
                        {Math.round(selected3D.angle_deg)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={Math.round(selected3D.angle_deg)}
                      onPointerDown={pushUndoSnapshot}
                      onChange={(e) =>
                        updateSelected3DField({ angle_deg: Number(e.target.value) })
                      }
                      className="w-full accent-sky-600 cursor-pointer"
                    />
                  </div>

                  {/* Fine Position Nudge (0.5m / 1m / 2m) & Click-to-Move */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">
                        ขยับตำแหน่งละเอียด
                      </span>
                      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                        {[0.5, 1, 2].map((step) => (
                          <button
                            key={`nudge-${step}`}
                            type="button"
                            onClick={() => setNudgeStepM(step)}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer ${
                              nudgeStepM === step
                                ? "bg-sky-600 text-white"
                                : "text-slate-600 hover:bg-white"
                            }`}
                          >
                            {step} ม.
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => nudgeSelected3D(nudgeStepM, 0)}
                        className="min-h-[36px] rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                        title={`เลื่อนขึ้นเหนือ ${nudgeStepM} ม.`}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeSelected3D(-nudgeStepM, 0)}
                        className="min-h-[36px] rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                        title={`เลื่อนลงใต้ ${nudgeStepM} ม.`}
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeSelected3D(0, -nudgeStepM)}
                        className="min-h-[36px] rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                        title={`เลื่อนซ้ายตะวันตก ${nudgeStepM} ม.`}
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeSelected3D(0, nudgeStepM)}
                        className="min-h-[36px] rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer"
                        title={`เลื่อนขวาตะวันออก ${nudgeStepM} ม.`}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClickToPlace3D(false);
                        setClickToMove3D((prev) => !prev);
                      }}
                      className={`w-full min-h-[34px] px-2.5 rounded-lg text-xs font-bold border cursor-pointer ${
                        clickToMove3D
                          ? "bg-amber-500 border-amber-600 text-white"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {clickToMove3D
                        ? "คลิกบนแผนที่เพื่อย้ายมาวางจุดนั้น..."
                        : "คลิกบนแผนที่เพื่อย้ายจุดกึ่งกลาง"}
                    </button>
                  </div>

                  {/* Wall Map Color Presets + Color Picker */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>สีบล็อก (โทนสีแผนผัง รพ.)</span>
                      <input
                        type="color"
                        value={selected3D.color || "#E2E8F0"}
                        onClick={pushUndoSnapshot}
                        onChange={(e) =>
                          updateSelected3DField({ color: e.target.value })
                        }
                        className="w-7 h-6 rounded border border-slate-200 cursor-pointer"
                        aria-label="เลือกสีบล็อกอิสระ"
                      />
                    </div>
                    <div className="grid grid-cols-6 gap-1.5">
                      {WALL_MAP_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          onClick={() =>
                            updateSelected3DField(
                              { color: preset.color },
                              undefined,
                              true
                            )
                          }
                          title={preset.label}
                          className={`h-7 rounded-lg border-2 cursor-pointer transition-transform ${
                            selected3D.color?.toLowerCase() ===
                            preset.color.toLowerCase()
                              ? "border-sky-600 scale-105"
                              : "border-slate-200 hover:scale-105"
                          }`}
                          style={{ backgroundColor: preset.color }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Delete / Reset Selected Building */}
                  <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleDeleteSelected3D}
                      className="min-h-[38px] px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-bold text-[#BE123C] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>ลบบล็อกนี้</span>
                    </button>
                    {!selected3DIsCustom && (
                      <button
                        type="button"
                        onClick={handleResetSelected3D}
                        className="min-h-[38px] px-3 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>รีเซ็ตตึกนี้</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected3D(null)}
                      className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-600 cursor-pointer"
                    >
                      ปิด
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Floating Collapsible Survey Tracks Panel when Mode 5 is active */}
        {showSurveys && (
          <aside className="absolute top-[70px] right-14 bottom-3 z-[425] w-80 max-w-[calc(100vw-24px)] rounded-2xl bg-white/97 backdrop-blur-md border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
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

            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/70 text-[11px] font-bold">
              <span className="text-slate-600">
                แสดงอยู่ {visibleSurveyIds.length}/{surveys.length} เส้น
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleSurveyIds(surveys.map((s) => s.id))}
                  className="text-[#0F766E] hover:underline cursor-pointer"
                >
                  เลือกทั้งหมด
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setVisibleSurveyIds([])}
                  className="text-slate-500 hover:underline cursor-pointer"
                >
                  ซ่อนทั้งหมด
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {surveys.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  ยังไม่มีรอยเดินสำรวจในระบบ สามารถบันทึกได้จากหน้า
                  &ldquo;เก็บพิกัดภาคสนาม&rdquo;
                </p>
              ) : (
                surveys.map((track) => {
                  const checked = visibleSurveyIds.includes(track.id);
                  const isCompleted = track.status === "completed";
                  const isSplitting = splitTrackId === track.id;
                  const ptCount = Array.isArray(track.points_json)
                    ? track.points_json.length
                    : 0;
                  return (
                    <div
                      key={track.id}
                      className={`rounded-xl border p-2.5 space-y-1.5 transition-colors ${
                        isSplitting
                          ? "border-sky-400 bg-sky-50/80 ring-2 ring-sky-400/20"
                          : checked
                          ? "border-slate-200 bg-white"
                          : "border-slate-100 bg-slate-50/60 opacity-70"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleSurveyVisible(track.id)}
                          aria-label={`แสดงรอยเดิน ${track.name}`}
                          className="w-4 h-4 mt-0.5 accent-[#0F766E] shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                              style={{
                                backgroundColor: track.color_hex || "#F97316",
                              }}
                            />
                            <p className="text-xs font-bold text-[#0F172A] truncate">
                              {track.name}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isCompleted
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {isCompleted ? "เสร็จแล้ว" : "กำลังทำ"}
                            </span>
                            {track.zone && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                {track.zone}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500">
                              {ptCount} จุด
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={ptCount < 3 || isSurveyBusy}
                            onClick={() => {
                              if (!checked) {
                                setVisibleSurveyIds((prev) => [...prev, track.id]);
                              }
                              setSplitTrackId((prev) =>
                                prev === track.id ? null : track.id
                              );
                            }}
                            title="ตัดแบ่งรอยเดินนี้เป็น 2 ท่อน"
                            aria-label={`ตัดแบ่งรอยเดิน ${track.name}`}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-35 ${
                              isSplitting
                                ? "bg-sky-600 text-white"
                                : "hover:bg-sky-50 text-sky-700"
                            }`}
                          >
                            <Scissors className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({
                                type: "survey",
                                id: track.id,
                                label: `รอยเดินสำรวจ "${track.name}"`,
                              })
                            }
                            className="w-7 h-7 rounded-lg hover:bg-rose-100 text-rose-600 flex items-center justify-center cursor-pointer"
                            aria-label={`ลบรอยเดิน ${track.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {surveys.length >= 2 && (
              <div className="p-3 border-t border-slate-200 bg-slate-50/90">
                <button
                  type="button"
                  onClick={handleOpenMergeModal}
                  disabled={visibleSurveyIds.length < 2 || isSurveyBusy}
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-45 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <GitMerge className="w-4 h-4" />
                  <span>
                    รวมรอยเดินที่ติ๊กเลือก ({visibleSurveyIds.length} เส้น)
                  </span>
                </button>
              </div>
            )}
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

      {/* Merge Survey Tracks Modal */}
      {mergeModalOpen && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-[#0F766E]" />
                <h2 className="font-heading text-base font-bold text-[#0F172A]">
                  รวมรอยเดินสำรวจ ({visibleSurveyIds.length} เส้น)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMergeModalOpen(false)}
                className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleMergeSurveys} className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                ระบบจะเรียงต่อรอยเดินทั้ง {visibleSurveyIds.length} เส้นโดยจับคู่จุดปลายที่ใกล้กันที่สุดให้อัตโนมัติ
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อรอยเดินที่รวมแล้ว *
                </label>
                <input
                  type="text"
                  required
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  โซนพื้นที่ (ไม่บังคับ)
                </label>
                <input
                  type="text"
                  value={mergeZone}
                  onChange={(e) => setMergeZone(e.target.value)}
                  placeholder="เช่น โซนแกนกลาง รพ."
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mergeDeleteOriginals}
                  onChange={(e) => setMergeDeleteOriginals(e.target.checked)}
                  className="w-4 h-4 accent-[#0F766E]"
                />
                <span>ลบรอยเดินต้นฉบับทั้ง {visibleSurveyIds.length} เส้นหลังรวมสำเร็จ</span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMergeModalOpen(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSurveyBusy}
                  className="min-h-[40px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSurveyBusy && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>รวมเป็นเส้นเดียว</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clone Draft Version Modal */}
      {cloneModalOpen && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                คัดลอกแผนที่เป็นฉบับร่างใหม่ (Clone Draft)
              </h2>
              <button
                type="button"
                onClick={() => setCloneModalOpen(false)}
                className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCloneVersion} className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                ระบบจะคัดลอกจุดอาคาร เส้นเชื่อม และโมเดล 3D ทั้งหมดจาก{" "}
                <strong className="text-[#0F172A]">
                  {activeVersion?.name}
                </strong>{" "}
                ไปสร้างเป็นฉบับร่างใหม่ เพื่อให้แก้ไขและดูตัวอย่างได้โดยไม่กระทบผู้ใช้จริง
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อเวอร์ชันฉบับร่าง *
                </label>
                <input
                  type="text"
                  required
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="เช่น ปรับปรุงเส้นทางอาคารใหม่ (v2)"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  คำอธิบาย (ไม่บังคับ)
                </label>
                <textarea
                  rows={2}
                  value={cloneDesc}
                  onChange={(e) => setCloneDesc(e.target.value)}
                  placeholder="บันทึกเหตุผลการแก้ไข เช่น เพิ่มทางเชื่อมอาคารใหม่"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCloneModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isVersionBusy}
                  className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  {isVersionBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>สร้างฉบับร่าง</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit / Delete Version Modal */}
      {editVersionModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                จัดการเวอร์ชัน #{editVersionModal.id}
              </h2>
              <button
                type="button"
                onClick={() => setEditVersionModal(null)}
                className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateVersionMeta} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อเวอร์ชัน *
                </label>
                <input
                  type="text"
                  required
                  value={editVersionModal.name}
                  onChange={(e) =>
                    setEditVersionModal((prev) =>
                      prev ? { ...prev, name: e.target.value } : null
                    )
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  คำอธิบาย
                </label>
                <textarea
                  rows={2}
                  value={editVersionModal.description}
                  onChange={(e) =>
                    setEditVersionModal((prev) =>
                      prev ? { ...prev, description: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                {!editVersionModal.is_live ? (
                  <button
                    type="button"
                    disabled={isVersionBusy}
                    onClick={() => handleDeleteDraftVersion(editVersionModal.id)}
                    className="min-h-[40px] px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-bold text-[#BE123C] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ลบฉบับร่างนี้</span>
                  </button>
                ) : (
                  <span className="text-[11px] font-semibold text-emerald-700">
                    เวอร์ชันใช้งานจริง (ลบไม่ได้)
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditVersionModal(null)}
                    className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={isVersionBusy}
                    className="min-h-[40px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {isVersionBusy && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>บันทึก</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Publish Live Version Modal */}
      {publishConfirmVersion && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-[#0F172A]">
                  ยืนยันการตั้งเป็นแผนที่จริง (Live)
                </h3>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  ต้องการเผยแพร่{" "}
                  <strong className="text-[#0F172A]">
                    {publishConfirmVersion.name}
                  </strong>{" "}
                  ให้ผู้ป่วยและญาติทุกคนเห็นบนหน้าหลักทันทีใช่หรือไม่? (เวอร์ชันเดิมจะถูกเก็บไว้เป็นฉบับสำรอง สามารถสลับกลับได้ตลอดเวลา)
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishConfirmVersion(null)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handlePublishVersion}
                disabled={isVersionBusy}
                className="min-h-[42px] px-4 rounded-xl bg-[#047857] hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                {isVersionBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>เผยแพร่ทันที</span>
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Edit Edge Attributes & Closure Modal (Mode 3) */}
      {edgeModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-heading text-base font-bold text-[#0F172A]">
                  แก้ไขคุณสมบัติเส้นทาง #{edgeModal.id}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  จุด #{edgeModal.from_node} ↔ จุด #{edgeModal.to_node} (ระยะทาง{" "}
                  {Math.round(edgeModal.distance_m)} ม.)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEdgeModal(null)}
                className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdge} className="p-5 space-y-4">
              {/* Active / Closed Status */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEdgeModal((prev) =>
                      prev ? { ...prev, is_active: true } : null
                    )
                  }
                  className={`min-h-[44px] px-3 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    edgeModal.is_active
                      ? "bg-[#0F766E] border-[#0F766E] text-white"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-teal-50"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>เปิดใช้งานปกติ</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEdgeModal((prev) =>
                      prev ? { ...prev, is_active: false } : null
                    )
                  }
                  className={`min-h-[44px] px-3 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    !edgeModal.is_active
                      ? "bg-[#BE123C] border-[#BE123C] text-white"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-rose-50"
                  }`}
                >
                  <ShieldAlert className="w-4 h-4" />
                  <span>ปิดปรับปรุงชั่วคราว</span>
                </button>
              </div>

              {/* Closure reason when closed */}
              {!edgeModal.is_active && (
                <div>
                  <label className="block text-xs font-bold text-[#BE123C] mb-1">
                    เหตุผลที่ปิดเส้นทาง (closure_reason)
                  </label>
                  <input
                    type="text"
                    value={edgeModal.closure_reason}
                    onChange={(e) =>
                      setEdgeModal((prev) =>
                        prev ? { ...prev, closure_reason: e.target.value } : null
                      )
                    }
                    placeholder="เช่น ซ่อมแซมทางเดิน / ก่อสร้างหลังคาเชื่อมอาคาร"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-rose-50/50 border border-rose-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#BE123C]"
                  />
                </div>
              )}

              {/* Edge Attributes */}
              <div className="space-y-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
                <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edgeModal.is_wheelchair_friendly}
                    onChange={(e) =>
                      setEdgeModal((prev) =>
                        prev
                          ? { ...prev, is_wheelchair_friendly: e.target.checked }
                          : null
                      )
                    }
                    className="w-4 h-4 accent-[#0F766E]"
                  />
                  <Accessibility className="w-4 h-4 text-[#0F766E]" />
                  <span>รองรับรถเข็นผู้ป่วย (Wheelchair Friendly)</span>
                </label>

                <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edgeModal.is_covered}
                    onChange={(e) =>
                      setEdgeModal((prev) =>
                        prev ? { ...prev, is_covered: e.target.checked } : null
                      )
                    }
                    className="w-4 h-4 accent-sky-600"
                  />
                  <Umbrella className="w-4 h-4 text-sky-600" />
                  <span>ทางเชื่อมมีหลังคา กันแดด/กันฝน (is_covered)</span>
                </label>

                <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={edgeModal.is_indoor_passthrough}
                    onChange={(e) =>
                      setEdgeModal((prev) =>
                        prev
                          ? { ...prev, is_indoor_passthrough: e.target.checked }
                          : null
                      )
                    }
                    className="w-4 h-4 accent-violet-600"
                  />
                  <Building2 className="w-4 h-4 text-violet-600" />
                  <span>เดินทะลุภายในอาคาร (is_indoor_passthrough)</span>
                </label>
              </div>

              {/* Instruction */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  คำอธิบายทางเดิน (Instruction)
                </label>
                <input
                  type="text"
                  value={edgeModal.instruction}
                  onChange={(e) =>
                    setEdgeModal((prev) =>
                      prev ? { ...prev, instruction: e.target.value } : null
                    )
                  }
                  placeholder="เช่น เดินตรงตามทางเชื่อมมีหลังคา ผ่านร้านกาแฟ"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEdgeModal(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdge}
                  className="min-h-[42px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  {isSavingEdge && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>บันทึกเส้นทาง</span>
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
