"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Box,
  Building2,
  CheckCircle2,
  Clock,
  Headphones,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  extractApiError,
  type Category,
  type Department,
  type MapNode,
  type ServicePoint,
  type UploadResponse,
} from "@/lib/api";
import { HOSPITAL_CENTER } from "@/lib/hospital";

type DirectoryMode = "buildings" | "service_points";

const SERVICE_STATUS_OPTIONS: {
  value: "open" | "open_24h" | "maintenance";
  label: string;
  pillCls: string;
  dotCls: string;
}[] = [
  {
    value: "open",
    label: "เปิดบริการปกติ",
    pillCls: "bg-teal-50 text-[#0F766E] border-teal-200",
    dotCls: "bg-emerald-500",
  },
  {
    value: "open_24h",
    label: "เปิด 24 ชั่วโมง",
    pillCls: "bg-rose-50 text-[#BE123C] border-rose-200",
    dotCls: "bg-[#BE123C]",
  },
  {
    value: "maintenance",
    label: "ปิดปรับปรุง",
    pillCls: "bg-amber-50 text-amber-800 border-amber-200",
    dotCls: "bg-amber-500",
  },
];

const SERVICE_TYPE_LABELS: Record<string, string> = {
  emergency: "ฉุกเฉิน / สายด่วน",
  info: "ประชาสัมพันธ์",
  opd: "ผู้ป่วยนอก (OPD)",
  wheelchair: "รถเข็น / ผู้สูงอายุ",
  parking: "ลานจอดรถ",
  general: "บริการทั่วไป",
};

function getServiceStatusMeta(status?: string) {
  return (
    SERVICE_STATUS_OPTIONS.find((opt) => opt.value === status) ??
    SERVICE_STATUS_OPTIONS[0]
  );
}

interface BuildingForm {
  id: number | null;
  name: string;
  building_code: string;
  badge_label: string;
  floor_range: string;
  service_status: "open" | "open_24h" | "maintenance";
  category_id: number | null;
  keywords: string;
  indoor_guide: string;
  image_url: string;
  lat: number;
  lng: number;
}

interface CategoryForm {
  id: number | null;
  name: string;
  slug: string;
  color_hex: string;
  badge_bg: string;
  sort_order: number;
  show_in_legend: boolean;
}

interface DepartmentForm {
  id: number | null;
  node_id: number;
  name: string;
  floor: string;
  operating_hours: string;
  phone: string;
  keywords: string;
}

interface ServicePointForm {
  id: number | null;
  node_id: number | null;
  type: string;
  name: string;
  description: string;
  phone: string;
  is_active: boolean;
}

export default function AdminDirectoryPage() {
  const [mode, setMode] = useState<DirectoryMode>("buildings");
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<number | "all">("all");
  const [searchText, setSearchText] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(
    null
  );
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Modals
  const [buildingModal, setBuildingModal] = useState<BuildingForm | null>(null);
  const [catModal, setCatModal] = useState<CategoryForm | null>(null);
  const [deptModal, setDeptModal] = useState<DepartmentForm | null>(null);
  const [spModal, setSpModal] = useState<ServicePointForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "building" | "category" | "department" | "service_point";
    id: number;
    label: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);

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

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nodesRes, catsRes, deptsRes, spRes] = await Promise.all([
        api.get<MapNode[]>("/api/admin/nodes"),
        api.get<Category[]>("/api/admin/categories"),
        api.get<Department[]>("/api/admin/departments"),
        api.get<ServicePoint[]>("/api/admin/service-points"),
      ]);
      const nodeList = Array.isArray(nodesRes.data) ? nodesRes.data : [];
      setNodes(nodeList);
      setCategories(Array.isArray(catsRes.data) ? catsRes.data : []);
      setDepartments(Array.isArray(deptsRes.data) ? deptsRes.data : []);
      setServicePoints(Array.isArray(spRes.data) ? spRes.data : []);

      const bldgs = nodeList.filter((n) => n.is_building);
      setSelectedBuildingId((prev) => {
        if (prev && bldgs.some((b) => b.id === prev)) return prev;
        return bldgs.length > 0 ? bldgs[0].id : null;
      });
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถโหลดข้อมูลอาคารได้"));
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const buildings = useMemo(
    () => nodes.filter((n) => n.is_building),
    [nodes]
  );

  const categoryById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const deptsByNodeId = useMemo(() => {
    const m = new Map<number, Department[]>();
    for (const d of departments) {
      const list = m.get(d.node_id) ?? [];
      list.push(d);
      m.set(d.node_id, list);
    }
    return m;
  }, [departments]);

  const countByCatId = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of buildings) {
      if (b.category_id) {
        m.set(b.category_id, (m.get(b.category_id) || 0) + 1);
      }
    }
    return m;
  }, [buildings]);

  const qLower = searchText.trim().toLowerCase();

  const filteredBuildings = useMemo(() => {
    return buildings.filter((b) => {
      if (selectedCatId !== "all" && b.category_id !== selectedCatId) {
        return false;
      }
      if (!qLower) return true;
      const deptsText = (deptsByNodeId.get(b.id) ?? [])
        .map((d) => `${d.name} ${d.floor} ${d.keywords}`)
        .join(" ");
      const hay = `${b.name} ${b.building_code || ""} ${b.badge_label || ""} ${b.keywords || ""} ${b.indoor_guide || ""} ${deptsText}`.toLowerCase();
      return hay.includes(qLower);
    });
  }, [buildings, selectedCatId, qLower, deptsByNodeId]);

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId]
  );

  const selectedBuildingDepts = useMemo(() => {
    if (!selectedBuilding) return [];
    const list = [...(deptsByNodeId.get(selectedBuilding.id) ?? [])];
    const floorRank = (f: string) => {
      const clean = f.replace(/ชั้น/g, "").trim().toUpperCase();
      if (!clean) return 999;
      if (clean.startsWith("G") || clean.startsWith("B")) return 0;
      const m = clean.match(/\d+/);
      return m ? parseInt(m[0], 10) : 500;
    };
    list.sort((a, b) => floorRank(a.floor) - floorRank(b.floor) || a.id - b.id);
    return list;
  }, [selectedBuilding, deptsByNodeId]);

  const openEditBuildingModal = (b?: MapNode) => {
    if (b) {
      setBuildingModal({
        id: b.id,
        name: b.name || "",
        building_code: b.building_code || `BLD-${String(b.id).padStart(2, "0")}`,
        badge_label: b.badge_label || "",
        floor_range: b.floor_range || "",
        service_status:
          (b.service_status as "open" | "open_24h" | "maintenance") || "open",
        category_id: b.category_id ?? null,
        keywords: b.keywords || "",
        indoor_guide: b.indoor_guide || "",
        image_url: b.image_url || "",
        lat: b.lat,
        lng: b.lng,
      });
    } else {
      setBuildingModal({
        id: null,
        name: "",
        building_code: "",
        badge_label: "",
        floor_range: "",
        service_status: "open",
        category_id:
          selectedCatId !== "all"
            ? selectedCatId
            : categories[0]?.id ?? null,
        keywords: "",
        indoor_guide: "",
        image_url: "",
        lat: HOSPITAL_CENTER[0],
        lng: HOSPITAL_CENTER[1],
      });
    }
  };

  const handleSaveBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingModal || !buildingModal.name.trim()) {
      showToast("error", "กรุณากรอกชื่ออาคาร");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: buildingModal.name.trim(),
        is_building: true,
        building_code: buildingModal.building_code.trim(),
        badge_label: buildingModal.badge_label.trim(),
        floor_range: buildingModal.floor_range.trim(),
        service_status: buildingModal.service_status,
        category_id: buildingModal.category_id,
        clear_category: buildingModal.category_id === null,
        keywords: buildingModal.keywords.trim(),
        indoor_guide: buildingModal.indoor_guide.trim(),
        image_url: buildingModal.image_url.trim(),
        lat: Number(buildingModal.lat),
        lng: Number(buildingModal.lng),
      };
      if (buildingModal.id) {
        await api.put(`/api/admin/nodes/${buildingModal.id}`, payload);
        showToast("success", "บันทึกข้อมูลอาคารเรียบร้อยแล้ว");
      } else {
        const res = await api.post<MapNode>("/api/admin/nodes", payload);
        if (res.data?.id) {
          setSelectedBuildingId(res.data.id);
        }
        showToast("success", "เพิ่มอาคารใหม่เรียบร้อยแล้ว");
      }
      setBuildingModal(null);
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกข้อมูลอาคารได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickStatusChange = async (
    building: MapNode,
    nextStatus: "open" | "open_24h" | "maintenance"
  ) => {
    if ((building.service_status || "open") === nextStatus) return;
    setUpdatingStatusId(building.id);
    try {
      await api.put(`/api/admin/nodes/${building.id}`, {
        name: building.name,
        is_building: true,
        service_status: nextStatus,
        keywords: building.keywords || "",
        indoor_guide: building.indoor_guide || "",
        image_url: building.image_url || "",
        lat: building.lat,
        lng: building.lng,
      });
      setNodes((prev) =>
        prev.map((n) =>
          n.id === building.id ? { ...n, service_status: nextStatus } : n
        )
      );
      showToast(
        "success",
        `เปลี่ยนสถานะเป็น "${getServiceStatusMeta(nextStatus).label}" แล้ว`
      );
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถเปลี่ยนสถานะบริการได้"));
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleDirectPhotoUpload = async (
    building: MapNode,
    file: File | null
  ) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await api.post<UploadResponse>(
        "/api/admin/upload",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const nextUrl = uploadRes.data.image_url || uploadRes.data.url || "";
      if (!nextUrl) throw new Error("ไม่พบ URL รูปภาพ");

      await api.put(`/api/admin/nodes/${building.id}`, {
        name: building.name,
        is_building: true,
        keywords: building.keywords || "",
        indoor_guide: building.indoor_guide || "",
        image_url: nextUrl,
        lat: building.lat,
        lng: building.lng,
      });
      setNodes((prev) =>
        prev.map((n) =>
          n.id === building.id ? { ...n, image_url: nextUrl } : n
        )
      );
      showToast("success", "อัปโหลดรูปภาพอาคารเรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "อัปโหลดรูปภาพไม่สำเร็จ"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catModal || !catModal.name.trim()) {
      showToast("error", "กรุณากรอกชื่อหมวดหมู่");
      return;
    }
    const slug =
      catModal.slug.trim().toLowerCase() ||
      `cat_${Date.now().toString(36)}`;
    setIsSaving(true);
    try {
      const payload = {
        name: catModal.name.trim(),
        slug,
        color_hex: catModal.color_hex || "#0F766E",
        badge_bg: catModal.badge_bg || "#CCFBF1",
        sort_order: Number(catModal.sort_order) || 0,
        show_in_legend: catModal.show_in_legend,
      };
      if (catModal.id) {
        await api.put(`/api/admin/categories/${catModal.id}`, payload);
        showToast("success", "บันทึกหมวดหมู่เรียบร้อยแล้ว");
      } else {
        await api.post("/api/admin/categories", payload);
        showToast("success", "เพิ่มหมวดหมู่ใหม่เรียบร้อยแล้ว");
      }
      setCatModal(null);
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกหมวดหมู่ได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptModal || !deptModal.name.trim() || !deptModal.node_id) {
      showToast("error", "กรุณากรอกชื่อแผนกให้ครบถ้วน");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        node_id: Number(deptModal.node_id),
        name: deptModal.name.trim(),
        floor: deptModal.floor.trim(),
        operating_hours: deptModal.operating_hours.trim(),
        phone: deptModal.phone.trim(),
        keywords: deptModal.keywords.trim(),
      };
      if (deptModal.id) {
        await api.put(`/api/admin/departments/${deptModal.id}`, payload);
        showToast("success", "บันทึกข้อมูลแผนกเรียบร้อยแล้ว");
      } else {
        await api.post("/api/admin/departments", payload);
        showToast("success", "เพิ่มแผนกใหม่เรียบร้อยแล้ว");
      }
      setDeptModal(null);
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกแผนกได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveServicePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spModal || !spModal.name.trim()) {
      showToast("error", "กรุณากรอกชื่อจุดบริการ");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        node_id: spModal.node_id,
        type: spModal.type || "general",
        name: spModal.name.trim(),
        description: spModal.description.trim(),
        phone: spModal.phone.trim(),
        is_active: spModal.is_active,
      };
      if (spModal.id) {
        await api.put(`/api/admin/service-points/${spModal.id}`, payload);
        showToast("success", "อัปเดตจุดบริการเรียบร้อยแล้ว");
      } else {
        await api.post("/api/admin/service-points", payload);
        showToast("success", "เพิ่มจุดบริการใหม่เรียบร้อยแล้ว");
      }
      setSpModal(null);
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกจุดบริการได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.kind === "building") {
        await api.delete(`/api/admin/nodes/${deleteTarget.id}`);
        if (selectedBuildingId === deleteTarget.id) {
          setSelectedBuildingId(null);
          setMobileDetailOpen(false);
        }
      } else if (deleteTarget.kind === "category") {
        await api.delete(`/api/admin/categories/${deleteTarget.id}`);
        if (selectedCatId === deleteTarget.id) setSelectedCatId("all");
      } else if (deleteTarget.kind === "department") {
        await api.delete(`/api/admin/departments/${deleteTarget.id}`);
      } else if (deleteTarget.kind === "service_point") {
        await api.delete(`/api/admin/service-points/${deleteTarget.id}`);
      }
      showToast("success", `ลบ "${deleteTarget.label}" เรียบร้อยแล้ว`);
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถลบรายการได้"));
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedCatObj =
    selectedCatId !== "all" ? categoryById.get(selectedCatId) ?? null : null;

  return (
    <div className="min-h-full bg-[#F8FAFC] pb-20 md:pb-8">
      {/* Toast Notification */}
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Top Page Header & Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-xl sm:text-2xl font-bold text-[#0F172A]">
              แก้ไขข้อมูลตึก & หมวดหมู่
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              จัดการหมวดหมู่ รายชื่ออาคาร แผนกรายชั้น สถานะบริการ และจุดบริการทั้งหมด
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-white border border-slate-200 p-1 shadow-xs">
              <button
                type="button"
                onClick={() => setMode("buildings")}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === "buildings"
                    ? "bg-[#0F766E] text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>ข้อมูลตึก ({buildings.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("service_points")}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === "service_points"
                    ? "bg-[#0F766E] text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>จุดบริการ ({servicePoints.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={loadAll}
              disabled={isLoading}
              aria-label="รีเฟรชข้อมูล"
              className="min-h-[40px] w-10 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center cursor-pointer"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* ==================== BUILDINGS & CATEGORIES MODE ==================== */}
        {mode === "buildings" && (
          <>
            {/* Top Category Bar (matches Image 2 left) */}
            <section className="rounded-2xl bg-white border border-slate-200 p-3.5 sm:p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#0F766E]" />
                  <h2 className="font-heading text-sm font-bold text-[#0F172A]">
                    หมวดหมู่
                  </h2>
                  {selectedCatObj && (
                    <div className="inline-flex items-center gap-1 ml-1">
                      <button
                        type="button"
                        onClick={() =>
                          setCatModal({
                            id: selectedCatObj.id,
                            name: selectedCatObj.name,
                            slug: selectedCatObj.slug,
                            color_hex: selectedCatObj.color_hex,
                            badge_bg: selectedCatObj.badge_bg,
                            sort_order: selectedCatObj.sort_order,
                            show_in_legend: selectedCatObj.show_in_legend,
                          })
                        }
                        className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>แก้หมวดหมู่นี้</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "category",
                            id: selectedCatObj.id,
                            label: selectedCatObj.name,
                          })
                        }
                        className="px-2 py-0.5 rounded-md bg-rose-50 hover:bg-rose-100 text-[11px] font-semibold text-[#BE123C] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>ลบ</span>
                      </button>
                    </div>
                  )}
                </div>

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
                  className="min-h-[34px] px-3 rounded-full bg-teal-50 hover:bg-teal-100 border border-teal-200 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>เพิ่มหมวดหมู่</span>
                </button>
              </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedCatId("all")}
                  className={`min-h-[36px] px-3.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors cursor-pointer ${
                    selectedCatId === "all"
                      ? "bg-[#0F766E] border-[#0F766E] text-white shadow-xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-teal-300"
                  }`}
                >
                  ทั้งหมด ({buildings.length})
                </button>
                {categories.map((cat) => {
                  const isActive = selectedCatId === cat.id;
                  const cnt = countByCatId.get(cat.id) ?? 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCatId(cat.id)}
                      className={`min-h-[36px] px-3.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
                        isActive
                          ? "bg-[#0F766E] border-[#0F766E] text-white shadow-xs"
                          : "bg-slate-50 border-slate-200 text-slate-700 hover:border-teal-300"
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: isActive ? "#FFFFFF" : cat.color_hex,
                        }}
                      />
                      <span>
                        {cat.name} ({cnt})
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="ค้นหาชื่อตึก, แผนก หรือรหัสอาคาร..."
                  className="w-full min-h-[42px] pl-10 pr-9 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#0F766E] focus:bg-white transition-colors"
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText("")}
                    aria-label="ล้างคำค้นหา"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </section>

            {/* Master-Detail Grid */}
            {isLoading ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-12 flex flex-col items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
                <span className="text-sm font-medium">
                  กำลังโหลดข้อมูลอาคารและแผนก...
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 items-start">
                {/* LEFT COLUMN: Building Cards List */}
                <div
                  className={`space-y-3 ${
                    mobileDetailOpen ? "hidden lg:block" : "block"
                  }`}
                >
                  {filteredBuildings.length === 0 ? (
                    <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-2">
                      <Building2 className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-sm font-bold text-slate-700">
                        ไม่พบอาคารที่ตรงกับเงื่อนไข
                      </p>
                    </div>
                  ) : (
                    filteredBuildings.map((b) => {
                      const statusMeta = getServiceStatusMeta(b.service_status);
                      const cat = b.category_id
                        ? categoryById.get(b.category_id)
                        : null;
                      const bDepts = deptsByNodeId.get(b.id) ?? [];
                      const isSelected = selectedBuilding?.id === b.id;
                      const deptPreview = bDepts
                        .slice(0, 3)
                        .map((d) => d.name)
                        .join(", ");

                      return (
                        <article
                          key={b.id}
                          onClick={() => {
                            setSelectedBuildingId(b.id);
                            setMobileDetailOpen(true);
                          }}
                          className={`rounded-2xl bg-white border p-4 transition-all cursor-pointer ${
                            isSelected
                              ? "border-[#0F766E] ring-2 ring-teal-600/15 shadow-sm"
                              : "border-slate-200 hover:border-teal-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-heading text-[15px] font-bold text-[#0F172A] leading-snug">
                              {b.name || `อาคาร #${b.id}`}
                            </h3>
                            <span
                              className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusMeta.pillCls}`}
                            >
                              {statusMeta.label}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center flex-wrap gap-1.5 text-xs">
                            <span
                              className="px-2 py-0.5 rounded-md font-bold text-[11px]"
                              style={{
                                backgroundColor: cat?.badge_bg || "#CCFBF1",
                                color: cat?.color_hex || "#0F766E",
                              }}
                            >
                              {b.badge_label || b.building_code || "อาคาร"}
                            </span>
                            {cat && (
                              <span className="text-slate-600 font-medium">
                                {cat.name}
                              </span>
                            )}
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-500">
                              {bDepts.length} แผนก
                            </span>
                          </div>

                          <p className="mt-2 text-xs text-slate-500 line-clamp-1">
                            {b.floor_range ? `ชั้น ${b.floor_range} • ` : ""}
                            {deptPreview ||
                              b.keywords ||
                              "ยังไม่มีข้อมูลแผนกในอาคารนี้"}
                          </p>

                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBuildingId(b.id);
                                setMobileDetailOpen(true);
                              }}
                              className="min-h-[34px] px-3 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200/80 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>แก้ไขข้อมูล</span>
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}

                  {/* Bottom "+ เพิ่มตึกใหม่" button (matches Image 2 left) */}
                  <button
                    type="button"
                    onClick={() => openEditBuildingModal()}
                    className="w-full min-h-[46px] rounded-2xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>เพิ่มตึกใหม่</span>
                  </button>
                </div>

                {/* RIGHT COLUMN: Building Detail & Editor Profile (matches Image 2 center) */}
                <div
                  className={`${
                    mobileDetailOpen ? "block" : "hidden lg:block"
                  }`}
                >
                  {selectedBuilding ? (
                    <div className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
                      {/* Mobile Back Button */}
                      <div className="lg:hidden px-4 pt-3 pb-1 border-b border-slate-100">
                        <button
                          type="button"
                          onClick={() => setMobileDetailOpen(false)}
                          className="min-h-[36px] text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          <span>กลับรายชื่อตึก</span>
                        </button>
                      </div>

                      <div className="p-4 sm:p-5 space-y-5">
                        {/* Building Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-500">
                              {(selectedBuilding.category_id &&
                                categoryById.get(selectedBuilding.category_id)
                                  ?.name) ||
                                "ไม่ระบุหมวดหมู่"}
                            </p>
                            <h2 className="font-heading text-lg sm:text-xl font-bold text-[#0F172A] mt-0.5 leading-snug">
                              {selectedBuilding.name}
                            </h2>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                                getServiceStatusMeta(
                                  selectedBuilding.service_status
                                ).pillCls
                              }`}
                            >
                              {
                                getServiceStatusMeta(
                                  selectedBuilding.service_status
                                ).label
                              }
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                openEditBuildingModal(selectedBuilding)
                              }
                              aria-label="แก้ไขข้อมูลพื้นฐานอาคาร"
                              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: "building",
                                  id: selectedBuilding.id,
                                  label: selectedBuilding.name,
                                })
                              }
                              aria-label="ลบอาคาร"
                              className="w-9 h-9 rounded-xl bg-rose-50 hover:bg-rose-100 text-[#BE123C] flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Building Photo */}
                        <div className="relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 aspect-[16/9] max-h-[240px] w-full flex items-center justify-center">
                          {selectedBuilding.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={selectedBuilding.image_url}
                              alt={selectedBuilding.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1.5 text-slate-400">
                              <ImageIcon className="w-8 h-8" />
                              <span className="text-xs font-medium">
                                ยังไม่มีรูปภาพอาคาร
                              </span>
                            </div>
                          )}

                          <label className="absolute bottom-3 right-3 min-h-[36px] px-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-bold inline-flex items-center gap-1.5 backdrop-blur-xs cursor-pointer">
                            {isUploading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Upload className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {selectedBuilding.image_url
                                ? "เปลี่ยนรูปภาพ"
                                : "อัปโหลดรูปอาคาร"}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={isUploading}
                              onChange={(e) =>
                                handleDirectPhotoUpload(
                                  selectedBuilding,
                                  e.target.files?.[0] ?? null
                                )
                              }
                            />
                          </label>
                        </div>

                        {/* 3 Summary Stat Boxes (matches Image 2 center) */}
                        <div className="grid grid-cols-3 gap-2.5">
                          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                            <p className="font-heading text-sm sm:text-base font-bold text-[#0F172A] truncate">
                              {selectedBuilding.building_code ||
                                `BLD-${String(selectedBuilding.id).padStart(
                                  2,
                                  "0"
                                )}`}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              รหัสอาคาร
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                            <p className="font-heading text-sm sm:text-base font-bold text-[#0F172A]">
                              {selectedBuildingDepts.length} แผนก
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              จุดบริการ
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-center">
                            <p className="font-heading text-sm sm:text-base font-bold text-[#0F172A] truncate">
                              {selectedBuilding.floor_range || "-"}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              จำนวนชั้น
                            </p>
                          </div>
                        </div>

                        {/* Jump to 3D Map CTA */}
                        <Link
                          href={`/admin/map?focus_node=${selectedBuilding.id}`}
                          className="w-full min-h-[44px] rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-sm font-bold text-[#0F766E] inline-flex items-center justify-center gap-2 transition-colors"
                        >
                          <Box className="w-4 h-4" />
                          <span>ดูตำแหน่งบนแผนที่ 3D</span>
                        </Link>

                        {/* Floor-by-Floor Departments Section */}
                        <div className="space-y-3 pt-1 border-t border-slate-100">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Stethoscope className="w-4 h-4 text-[#0F766E]" />
                              <h3 className="font-heading text-sm font-bold text-[#0F172A]">
                                แผนกและหอผู้ป่วยรายชั้น
                              </h3>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDeptModal({
                                  id: null,
                                  node_id: selectedBuilding.id,
                                  name: "",
                                  floor: "ชั้น 1",
                                  operating_hours: "จ.-ศ. 08:30 - 16:30 น.",
                                  phone: "042-176-000",
                                  keywords: "",
                                })
                              }
                              className="min-h-[34px] px-3 rounded-full bg-teal-50 hover:bg-teal-100 border border-teal-200 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>เพิ่มแผนก</span>
                            </button>
                          </div>

                          {selectedBuildingDepts.length === 0 ? (
                            <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
                              ยังไม่มีรายการแผนกในอาคารนี้ กด &ldquo;+
                              เพิ่มแผนก&rdquo; เพื่อเริ่มเพิ่มข้อมูลรายชั้น
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden bg-white">
                              {selectedBuildingDepts.map((dept) => (
                                <div
                                  key={dept.id}
                                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/70"
                                >
                                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <span className="shrink-0 min-w-[60px] text-center px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-700">
                                      {dept.floor || "ไม่ระบุ"}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-semibold text-slate-800 leading-snug">
                                        {dept.name}
                                      </p>
                                      {(dept.operating_hours || dept.phone) && (
                                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
                                          {dept.operating_hours && (
                                            <span className="inline-flex items-center gap-1">
                                              <Clock className="w-3 h-3 text-slate-400" />
                                              {dept.operating_hours}
                                            </span>
                                          )}
                                          {dept.phone && (
                                            <span className="inline-flex items-center gap-1">
                                              <Phone className="w-3 h-3 text-slate-400" />
                                              {dept.phone}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeptModal({
                                          id: dept.id,
                                          node_id: dept.node_id,
                                          name: dept.name,
                                          floor: dept.floor || "",
                                          operating_hours:
                                            dept.operating_hours || "",
                                          phone: dept.phone || "",
                                          keywords: dept.keywords || "",
                                        })
                                      }
                                      aria-label="แก้ไขแผนก"
                                      className="w-8 h-8 rounded-lg hover:bg-slate-200/70 text-slate-500 flex items-center justify-center cursor-pointer"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDeleteTarget({
                                          kind: "department",
                                          id: dept.id,
                                          label: dept.name,
                                        })
                                      }
                                      aria-label="ลบแผนก"
                                      className="w-8 h-8 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-[#BE123C] flex items-center justify-center cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Service Status Selector (matches Image 2 center bottom) */}
                        <div className="space-y-2.5 pt-2 border-t border-slate-100">
                          <div className="flex items-center justify-between">
                            <h3 className="font-heading text-sm font-bold text-[#0F172A]">
                              สถานะบริการปัจจุบัน
                            </h3>
                            {updatingStatusId === selectedBuilding.id && (
                              <Loader2 className="w-4 h-4 animate-spin text-[#0F766E]" />
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {SERVICE_STATUS_OPTIONS.map((opt) => {
                              const active =
                                (selectedBuilding.service_status || "open") ===
                                opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  disabled={
                                    updatingStatusId === selectedBuilding.id
                                  }
                                  onClick={() =>
                                    handleQuickStatusChange(
                                      selectedBuilding,
                                      opt.value
                                    )
                                  }
                                  className={`min-h-[42px] px-2.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                    active
                                      ? `${opt.pillCls} ring-2 ring-offset-1 ring-teal-500/20`
                                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${opt.dotCls}`}
                                  />
                                  <span className="truncate">{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-white border border-slate-200 p-12 text-center text-slate-500 text-sm">
                      เลือกอาคารจากรายการด้านซ้ายเพื่อดูและแก้ไขรายละเอียด
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ==================== SERVICE POINTS SUB-MODE ==================== */}
        {mode === "service_points" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                สายด่วน จุดประชาสัมพันธ์ จุดยืมรถเข็น และบริการผู้ป่วยที่แสดงในแท็บ
                &ldquo;จุดบริการ&rdquo; หน้าผู้ใช้
              </p>
              <button
                type="button"
                onClick={() =>
                  setSpModal({
                    id: null,
                    node_id: buildings[0]?.id ?? null,
                    type: "general",
                    name: "",
                    description: "",
                    phone: "",
                    is_active: true,
                  })
                }
                className="min-h-[40px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>เพิ่มจุดบริการ</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {servicePoints.map((sp) => (
                <article
                  key={sp.id}
                  className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block px-2 py-0.5 rounded-md bg-teal-50 text-[#0F766E] text-[11px] font-bold">
                          {SERVICE_TYPE_LABELS[sp.type] || sp.type}
                        </span>
                        <h3 className="font-heading text-sm font-bold text-[#0F172A] mt-1">
                          {sp.name}
                        </h3>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          sp.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {sp.is_active ? "เปิดใช้งาน" : "ซ่อนไว้"}
                      </span>
                    </div>
                    {sp.description && (
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {sp.description}
                      </p>
                    )}
                    {sp.phone && (
                      <p className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-[#0F766E]" />
                        {sp.phone}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() =>
                        setSpModal({
                          id: sp.id,
                          node_id: sp.node_id,
                          type: sp.type,
                          name: sp.name,
                          description: sp.description,
                          phone: sp.phone,
                          is_active: sp.is_active,
                        })
                      }
                      className="min-h-[34px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>แก้ไข</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({
                          kind: "service_point",
                          id: sp.id,
                          label: sp.name,
                        })
                      }
                      className="min-h-[34px] px-3 rounded-lg bg-rose-50 hover:bg-rose-100 text-xs font-bold text-[#BE123C] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>ลบ</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ==================== MODAL: ADD / EDIT BUILDING ==================== */}
      {buildingModal && (
        <div className="fixed inset-0 z-[800] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveBuilding}
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="font-heading text-base font-bold text-[#0F172A]">
                {buildingModal.id ? "แก้ไขข้อมูลอาคาร" : "เพิ่มตึกใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setBuildingModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่ออาคาร *
                </label>
                <input
                  type="text"
                  required
                  value={buildingModal.name}
                  onChange={(e) =>
                    setBuildingModal({ ...buildingModal, name: e.target.value })
                  }
                  placeholder="เช่น ตึก 8 ชั้น (อาคารหลักกลาง)"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    รหัสอาคาร
                  </label>
                  <input
                    type="text"
                    value={buildingModal.building_code}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        building_code: e.target.value,
                      })
                    }
                    placeholder="BLD-08"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ป้ายย่อ (Badge)
                  </label>
                  <input
                    type="text"
                    value={buildingModal.badge_label}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        badge_label: e.target.value,
                      })
                    }
                    placeholder="8 ชั้น / ER"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    จำนวนชั้น
                  </label>
                  <input
                    type="text"
                    value={buildingModal.floor_range}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        floor_range: e.target.value,
                      })
                    }
                    placeholder="G - 7"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    หมวดหมู่
                  </label>
                  <select
                    value={buildingModal.category_id ?? ""}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        category_id: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-[#0F766E]"
                  >
                    <option value="">-- ไม่ระบุหมวดหมู่ --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    สถานะบริการ
                  </label>
                  <select
                    value={buildingModal.service_status}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        service_status: e.target.value as
                          | "open"
                          | "open_24h"
                          | "maintenance",
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-[#0F766E]"
                  >
                    {SERVICE_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  คำค้นหา (คั่นด้วยเครื่องหมายจุลภาค)
                </label>
                <input
                  type="text"
                  value={buildingModal.keywords}
                  onChange={(e) =>
                    setBuildingModal({
                      ...buildingModal,
                      keywords: e.target.value,
                    })
                  }
                  placeholder="เช่น MICU, Stroke, หอผู้ป่วยใน, ห้องยา"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  คำแนะนำภายในอาคาร
                </label>
                <textarea
                  rows={3}
                  value={buildingModal.indoor_guide}
                  onChange={(e) =>
                    setBuildingModal({
                      ...buildingModal,
                      indoor_guide: e.target.value,
                    })
                  }
                  placeholder="รายละเอียดทางเข้า ลิฟต์ หรือตำแหน่งจุดบริการภายในตึก"
                  className="w-full p-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ละติจูด (Lat)
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    required
                    value={buildingModal.lat}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        lat: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ลองจิจูด (Lng)
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    required
                    value={buildingModal.lng}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        lng: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                type="button"
                onClick={() => setBuildingModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[40px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>บันทึกข้อมูล</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: ADD / EDIT CATEGORY ==================== */}
      {catModal && (
        <div className="fixed inset-0 z-[800] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCategory}
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-heading text-base font-bold text-[#0F172A]">
                {catModal.id ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่ใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setCatModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อหมวดหมู่ *
                </label>
                <input
                  type="text"
                  required
                  value={catModal.name}
                  onChange={(e) =>
                    setCatModal({ ...catModal, name: e.target.value })
                  }
                  placeholder="เช่น ตรวจ / รังสี / ยา"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Slug (ภาษาอังกฤษตัวเล็ก)
                </label>
                <input
                  type="text"
                  value={catModal.slug}
                  onChange={(e) =>
                    setCatModal({ ...catModal, slug: e.target.value })
                  }
                  placeholder="เช่น diagnostic (เว้นว่างให้ระบบสร้างอัตโนมัติ)"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    สีหลัก (Accent)
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
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
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
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={catModal.show_in_legend}
                  onChange={(e) =>
                    setCatModal({
                      ...catModal,
                      show_in_legend: e.target.checked,
                    })
                  }
                  className="rounded border-slate-300 text-[#0F766E]"
                />
                <span>แสดงในคำอธิบายสัญลักษณ์แผนที่ (Legend)</span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCatModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
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
      )}

      {/* ==================== MODAL: ADD / EDIT DEPARTMENT ==================== */}
      {deptModal && (
        <div className="fixed inset-0 z-[800] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDepartment}
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-heading text-base font-bold text-[#0F172A]">
                {deptModal.id ? "แก้ไขข้อมูลแผนก" : "เพิ่มแผนกใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setDeptModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ชั้น
                  </label>
                  <input
                    type="text"
                    value={deptModal.floor}
                    onChange={(e) =>
                      setDeptModal({ ...deptModal, floor: e.target.value })
                    }
                    placeholder="ชั้น G / ชั้น 1"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ชื่อแผนก / หอผู้ป่วย *
                  </label>
                  <input
                    type="text"
                    required
                    value={deptModal.name}
                    onChange={(e) =>
                      setDeptModal({ ...deptModal, name: e.target.value })
                    }
                    placeholder="เช่น MICU (หอผู้ป่วยวิกฤตอายุรกรรม)"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    เวลาทำการ
                  </label>
                  <input
                    type="text"
                    value={deptModal.operating_hours}
                    onChange={(e) =>
                      setDeptModal({
                        ...deptModal,
                        operating_hours: e.target.value,
                      })
                    }
                    placeholder="ตลอด 24 ชั่วโมง"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    เบอร์ติดต่อ
                  </label>
                  <input
                    type="text"
                    value={deptModal.phone}
                    onChange={(e) =>
                      setDeptModal({ ...deptModal, phone: e.target.value })
                    }
                    placeholder="042-176-000"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  คำค้นหาเพิ่มเติม
                </label>
                <input
                  type="text"
                  value={deptModal.keywords}
                  onChange={(e) =>
                    setDeptModal({ ...deptModal, keywords: e.target.value })
                  }
                  placeholder="เช่น ไอซียู, อายุรกรรม"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeptModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[40px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>บันทึกแผนก</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: ADD / EDIT SERVICE POINT ==================== */}
      {spModal && (
        <div className="fixed inset-0 z-[800] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveServicePoint}
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-heading text-base font-bold text-[#0F172A]">
                {spModal.id ? "แก้ไขจุดบริการ" : "เพิ่มจุดบริการใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setSpModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อจุดบริการ *
                </label>
                <input
                  type="text"
                  required
                  value={spModal.name}
                  onChange={(e) =>
                    setSpModal({ ...spModal, name: e.target.value })
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ประเภท
                  </label>
                  <select
                    value={spModal.type}
                    onChange={(e) =>
                      setSpModal({ ...spModal, type: e.target.value })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white"
                  >
                    {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    เบอร์โทร
                  </label>
                  <input
                    type="text"
                    value={spModal.phone}
                    onChange={(e) =>
                      setSpModal({ ...spModal, phone: e.target.value })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  อาคารที่ตั้ง (สำหรับปุ่มนำทาง)
                </label>
                <select
                  value={spModal.node_id ?? ""}
                  onChange={(e) =>
                    setSpModal({
                      ...spModal,
                      node_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white"
                >
                  <option value="">-- ไม่ผูกอาคาร --</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  รายละเอียด
                </label>
                <textarea
                  rows={2}
                  value={spModal.description}
                  onChange={(e) =>
                    setSpModal({ ...spModal, description: e.target.value })
                  }
                  className="w-full p-3 rounded-xl border border-slate-200"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={spModal.is_active}
                  onChange={(e) =>
                    setSpModal({ ...spModal, is_active: e.target.checked })
                  }
                  className="rounded border-slate-300 text-[#0F766E]"
                />
                <span>แสดงในหน้าผู้ใช้</span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSpModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[40px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>บันทึก</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: CONFIRM DELETE ==================== */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[850] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-[#BE123C] flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-heading text-base font-bold text-[#0F172A]">
                  ยืนยันการลบข้อมูล
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  คุณต้องการลบ &ldquo;{deleteTarget.label}&rdquo; ใช่หรือไม่?
                  (สามารถย้อนกลับได้ในหน้าประวัติการแก้ไข)
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[38px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="min-h-[38px] px-4 rounded-xl bg-[#BE123C] hover:bg-rose-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isDeleting && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>ยืนยันลบ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
