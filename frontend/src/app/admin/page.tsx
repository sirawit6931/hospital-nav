"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Box,
  Building2,
  Camera,
  CheckCircle2,
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
  Star,
  Stethoscope,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  extractApiError,
  getBuildingImages,
  type Category,
  type Department,
  type MapNode,
  type ServicePoint,
} from "@/lib/api";
import { HOSPITAL_CENTER } from "@/lib/hospital";
import { uploadCompressedImages } from "@/lib/imageUpload";

type WorkspaceMode = "buildings" | "service_points";

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

function normalizeFloorName(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "ไม่ระบุชั้น";
  if (t.startsWith("ชั้น")) return t;
  return `ชั้น ${t}`;
}

function floorSortRank(floor: string): number {
  const clean = floor.replace(/^ชั้น\s*/i, "").trim().toUpperCase();
  if (!clean || clean === "ไม่ระบุชั้น") return 999;
  if (clean.startsWith("B")) return -1;
  if (clean.startsWith("G")) return 0;
  const m = clean.match(/\d+/);
  return m ? parseInt(m[0], 10) : 500;
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
  image_urls: string[];
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

export default function AdminBuildingsWorkspacePage() {
  const [mode, setMode] = useState<WorkspaceMode>("buildings");
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedCatId, setSelectedCatId] = useState<number | "all">("all");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(
    null
  );
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Per-building Floor Builder state (allows creating empty floor cards & quick inline tag entry)
  const [customEmptyFloors, setCustomEmptyFloors] = useState<
    Record<number, string[]>
  >({});
  const [newFloorDraft, setNewFloorDraft] = useState("");
  const [addingFloorOpen, setAddingFloorOpen] = useState(false);
  const [quickRoomInputs, setQuickRoomInputs] = useState<
    Record<string, string>
  >({});
  const [savingFloorKey, setSavingFloorKey] = useState<string | null>(null);

  // Multi-photo preview & upload progress
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [uploadProgressText, setUploadProgressText] = useState<string | null>(
    null
  );

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

  const incompleteCount = useMemo(() => {
    return buildings.filter((b) => {
      const imgs = getBuildingImages(b);
      const dpts = deptsByNodeId.get(b.id) ?? [];
      return imgs.length === 0 || dpts.length === 0;
    }).length;
  }, [buildings, deptsByNodeId]);

  const qLower = searchText.trim().toLowerCase();

  const filteredBuildings = useMemo(() => {
    return buildings.filter((b) => {
      if (selectedCatId !== "all" && b.category_id !== selectedCatId) {
        return false;
      }
      if (onlyIncomplete) {
        const imgs = getBuildingImages(b);
        const dpts = deptsByNodeId.get(b.id) ?? [];
        if (imgs.length > 0 && dpts.length > 0) return false;
      }
      if (!qLower) return true;
      const deptsText = (deptsByNodeId.get(b.id) ?? [])
        .map((d) => `${d.name} ${d.floor} ${d.keywords}`)
        .join(" ");
      const hay = `${b.name} ${b.building_code || ""} ${b.badge_label || ""} ${b.keywords || ""
        } ${b.indoor_guide || ""} ${deptsText}`.toLowerCase();
      return hay.includes(qLower);
    });
  }, [buildings, selectedCatId, onlyIncomplete, qLower, deptsByNodeId]);

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId]
  );

  const selectedImages = useMemo(
    () => (selectedBuilding ? getBuildingImages(selectedBuilding) : []),
    [selectedBuilding]
  );

  useEffect(() => {
    setActivePhotoIndex(0);
    setAddingFloorOpen(false);
    setNewFloorDraft("");
  }, [selectedBuildingId]);

  useEffect(() => {
    if (activePhotoIndex >= selectedImages.length && selectedImages.length > 0) {
      setActivePhotoIndex(0);
    }
  }, [activePhotoIndex, selectedImages.length]);

  const floorSections = useMemo(() => {
    if (!selectedBuilding) return [];
    const grouped = new Map<string, Department[]>();

    const existingDepts = deptsByNodeId.get(selectedBuilding.id) ?? [];
    for (const d of existingDepts) {
      const fl = normalizeFloorName(d.floor);
      const list = grouped.get(fl) ?? [];
      list.push(d);
      grouped.set(fl, list);
    }

    const emptyExtras = customEmptyFloors[selectedBuilding.id] ?? [];
    for (const fl of emptyExtras) {
      const norm = normalizeFloorName(fl);
      if (!grouped.has(norm)) {
        grouped.set(norm, []);
      }
    }

    return Array.from(grouped.entries())
      .sort((a, b) => floorSortRank(a[0]) - floorSortRank(b[0]))
      .map(([floor, items]) => ({
        floor,
        items: items.sort((x, y) => x.id - y.id),
      }));
  }, [selectedBuilding, deptsByNodeId, customEmptyFloors]);

  const persistBuildingImages = async (
    building: MapNode,
    nextUrls: string[],
    coverUrl?: string
  ) => {
    const cover = coverUrl ?? nextUrls[0] ?? "";
    const res = await api.put<MapNode>(`/api/admin/nodes/${building.id}`, {
      name: building.name,
      is_building: true,
      keywords: building.keywords || "",
      indoor_guide: building.indoor_guide || "",
      image_url: cover,
      image_urls: nextUrls,
      lat: building.lat,
      lng: building.lng,
    });
    setNodes((prev) =>
      prev.map((n) => (n.id === building.id ? { ...n, ...res.data } : n))
    );
  };

  const handleUploadMultiplePhotos = async (
    building: MapNode,
    files: FileList | null
  ) => {
    if (!files || files.length === 0) return;
    setUploadProgressText(`กำลังบีบอัดและอัปโหลด 0/${files.length}...`);
    try {
      const uploaded = await uploadCompressedImages(files, (done, total) => {
        setUploadProgressText(`กำลังบีบอัดและอัปโหลด ${done}/${total}...`);
      });
      if (uploaded.length === 0) {
        throw new Error("ไม่พบไฟล์รูปภาพที่อัปโหลดสำเร็จ");
      }
      const current = getBuildingImages(building);
      const merged = Array.from(new Set([...current, ...uploaded]));
      await persistBuildingImages(building, merged, merged[0] || "");
      setActivePhotoIndex(merged.length - 1);
      showToast(
        "success",
        `เพิ่มรูปภาพ ${uploaded.length} รูปเรียบร้อยแล้ว (บีบอัดขนาดอัตโนมัติ)`
      );
    } catch (err) {
      showToast("error", extractApiError(err, "อัปโหลดรูปภาพไม่สำเร็จ"));
    } finally {
      setUploadProgressText(null);
    }
  };

  const handleSetCoverPhoto = async (building: MapNode, url: string) => {
    const current = getBuildingImages(building);
    const reordered = [url, ...current.filter((u) => u !== url)];
    try {
      await persistBuildingImages(building, reordered, url);
      setActivePhotoIndex(0);
      showToast("success", "ตั้งเป็นรูปปกอาคารเรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถตั้งรูปปกได้"));
    }
  };

  const handleRemovePhoto = async (building: MapNode, url: string) => {
    const current = getBuildingImages(building);
    const next = current.filter((u) => u !== url);
    try {
      await persistBuildingImages(building, next, next[0] ?? "");
      showToast("success", "ลบรูปภาพเรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถลบรูปภาพได้"));
    }
  };

  const handleAddFloorCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBuilding) return;
    const raw = newFloorDraft.trim();
    if (!raw) return;
    const label = normalizeFloorName(raw);
    setCustomEmptyFloors((prev) => {
      const existing = prev[selectedBuilding.id] ?? [];
      if (existing.includes(label)) return prev;
      return { ...prev, [selectedBuilding.id]: [...existing, label] };
    });
    setNewFloorDraft("");
    setAddingFloorOpen(false);
  };

  const handleQuickAddRooms = async (
    buildingId: number,
    floorLabel: string
  ) => {
    const key = `${buildingId}::${floorLabel}`;
    const raw = (quickRoomInputs[key] || "").trim();
    if (!raw) return;

    const roomNames = raw
      .split(/[,，\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (roomNames.length === 0) return;

    setSavingFloorKey(key);
    try {
      for (const roomName of roomNames) {
        await api.post("/api/admin/departments", {
          node_id: buildingId,
          name: roomName,
          floor: floorLabel,
          operating_hours: "",
          phone: "",
          keywords: "",
        });
      }
      setQuickRoomInputs((prev) => ({ ...prev, [key]: "" }));
      showToast(
        "success",
        roomNames.length === 1
          ? `เพิ่ม "${roomNames[0]}" ใน${floorLabel}แล้ว`
          : `เพิ่ม ${roomNames.length} ห้อง/แผนกใน${floorLabel}แล้ว`
      );
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถเพิ่มห้อง/แผนกได้"));
    } finally {
      setSavingFloorKey(null);
    }
  };

  const openEditBuildingModal = (b?: MapNode) => {
    if (b) {
      const imgs = getBuildingImages(b);
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
        image_url: imgs[0] || "",
        image_urls: imgs,
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
          selectedCatId !== "all" ? selectedCatId : categories[0]?.id ?? null,
        keywords: "",
        indoor_guide: "",
        image_url: "",
        image_urls: [],
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
        image_url: buildingModal.image_urls[0] || buildingModal.image_url.trim(),
        image_urls: buildingModal.image_urls,
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
          setMobileDetailOpen(true);
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
      const imgs = getBuildingImages(building);
      await api.put(`/api/admin/nodes/${building.id}`, {
        name: building.name,
        is_building: true,
        service_status: nextStatus,
        keywords: building.keywords || "",
        indoor_guide: building.indoor_guide || "",
        image_url: imgs[0] || "",
        image_urls: imgs,
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

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catModal || !catModal.name.trim()) {
      showToast("error", "กรุณากรอกชื่อหมวดหมู่");
      return;
    }
    const slug =
      catModal.slug.trim().toLowerCase() || `cat_${Date.now().toString(36)}`;
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
      showToast("error", "กรุณากรอกชื่อห้อง/แผนกให้ครบถ้วน");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        node_id: Number(deptModal.node_id),
        name: deptModal.name.trim(),
        floor: normalizeFloorName(deptModal.floor),
        operating_hours: deptModal.operating_hours.trim(),
        phone: deptModal.phone.trim(),
        keywords: deptModal.keywords.trim(),
      };
      if (deptModal.id) {
        await api.put(`/api/admin/departments/${deptModal.id}`, payload);
        showToast("success", "อัปเดตข้อมูลห้อง/แผนกเรียบร้อยแล้ว");
      } else {
        await api.post("/api/admin/departments", payload);
        showToast("success", "เพิ่มห้อง/แผนกเรียบร้อยแล้ว");
      }
      setDeptModal(null);
      await loadAll();
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกห้อง/แผนกได้"));
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

  const selectedBuildingDeptsCount = selectedBuilding
    ? (deptsByNodeId.get(selectedBuilding.id) ?? []).length
    : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8FAFC] pb-20 md:pb-8">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[900] max-w-sm rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-semibold ${toast.type === "success"
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
        {/* Header & Mode Switch */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-xl sm:text-2xl font-bold text-[#0F172A]">
              ข้อมูลตึก & แผนก
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-white border border-slate-200 p-1 shadow-xs">
              <button
                type="button"
                onClick={() => setMode("buildings")}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${mode === "buildings"
                    ? "bg-[#0F766E] text-white"
                    : "text-slate-600 hover:bg-slate-50"
                  }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>รายชื่อตึก ({buildings.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("service_points")}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${mode === "service_points"
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

        {/* ==================== BUILDINGS PER-BUILDING WORKSPACE ==================== */}
        {mode === "buildings" && (
          <>
            {/* Compact Category & Search Bar */}
            <section className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Layers className="w-4 h-4 text-[#0F766E]" />
                  <span className="font-heading text-sm font-bold text-[#0F172A]">
                    หมวดหมู่
                  </span>
                  {selectedCatObj && (
                    <div className="inline-flex items-center gap-1">
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
                        <span>แก้ไข</span>
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

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOnlyIncomplete((v) => !v)}
                    className={`min-h-[32px] px-3 rounded-full text-xs font-bold border transition-colors cursor-pointer ${onlyIncomplete
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
                      }`}
                  >
                    ยังไม่ครบ ({incompleteCount})
                  </button>
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
                    className="min-h-[32px] px-3 rounded-full bg-teal-50 hover:bg-teal-100 border border-teal-200 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>เพิ่มหมวดหมู่</span>
                  </button>
                </div>
              </div>

              {/* Category Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedCatId("all")}
                  className={`min-h-[34px] px-3 rounded-full text-xs font-bold whitespace-nowrap border transition-colors cursor-pointer ${selectedCatId === "all"
                      ? "bg-[#0F766E] border-[#0F766E] text-white"
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
                      className={`min-h-[34px] px-3 rounded-full text-xs font-bold whitespace-nowrap border transition-colors inline-flex items-center gap-1.5 cursor-pointer ${isActive
                          ? "bg-[#0F766E] border-[#0F766E] text-white"
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

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="ค้นหาชื่อตึก, ห้อง, แผนก เช่น ห้องเอกซเรย์, ห้องผ่าตัด..."
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

            {isLoading ? (
              <div className="rounded-2xl bg-white border border-slate-200 p-12 flex flex-col items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
                <span className="text-sm font-medium">
                  กำลังโหลดข้อมูลอาคารและห้อง/แผนก...
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
                {/* LEFT COLUMN: Clean Per-Building List */}
                <div
                  className={`space-y-2.5 ${mobileDetailOpen ? "hidden lg:block" : "block"
                    }`}
                >
                  <button
                    type="button"
                    onClick={() => openEditBuildingModal()}
                    className="w-full min-h-[44px] rounded-2xl bg-[#0F766E] hover:bg-[#115E59] text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>เพิ่มตึกใหม่</span>
                  </button>

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
                      const bImgs = getBuildingImages(b);
                      const bDepts = deptsByNodeId.get(b.id) ?? [];
                      const isSelected = selectedBuilding?.id === b.id;

                      return (
                        <article
                          key={b.id}
                          onClick={() => {
                            setSelectedBuildingId(b.id);
                            setMobileDetailOpen(true);
                          }}
                          className={`rounded-2xl bg-white border p-3.5 transition-all cursor-pointer ${isSelected
                              ? "border-[#0F766E] ring-2 ring-teal-600/15 shadow-sm"
                              : "border-slate-200 hover:border-teal-300"
                            }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Mini Thumbnail */}
                            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                              {bImgs[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={bImgs[0]}
                                  alt={b.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Building2 className="w-5 h-5 text-slate-400" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="font-heading text-sm font-bold text-[#0F172A] leading-snug line-clamp-2">
                                  {b.name || `อาคาร #${b.id}`}
                                </h3>
                                <span
                                  className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusMeta.pillCls}`}
                                >
                                  {statusMeta.label}
                                </span>
                              </div>

                              <div className="mt-1.5 flex items-center flex-wrap gap-1.5 text-[11px]">
                                <span
                                  className="px-2 py-0.5 rounded-md font-bold"
                                  style={{
                                    backgroundColor: cat?.badge_bg || "#CCFBF1",
                                    color: cat?.color_hex || "#0F766E",
                                  }}
                                >
                                  {b.badge_label || b.building_code || "อาคาร"}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded-md font-semibold ${bImgs.length > 0
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-amber-50 text-amber-700"
                                    }`}
                                >
                                  {bImgs.length > 0
                                    ? `${bImgs.length} รูป`
                                    : "ยังไม่มีรูป"}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded-md font-semibold ${bDepts.length > 0
                                      ? "bg-teal-50 text-[#0F766E]"
                                      : "bg-amber-50 text-amber-700"
                                    }`}
                                >
                                  {bDepts.length > 0
                                    ? `${bDepts.length} ห้อง/แผนก`
                                    : "ยังไม่มีแผนก"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>

                {/* RIGHT COLUMN: Dedicated Per-Building Profile + Multi-Photo + Floor Tag Builder */}
                <div
                  className={`${mobileDetailOpen ? "block" : "hidden lg:block"
                    }`}
                >
                  {selectedBuilding ? (
                    <div className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
                      {/* Mobile Back Bar */}
                      <div className="lg:hidden px-4 pt-3 pb-2 border-b border-slate-100">
                        <button
                          type="button"
                          onClick={() => setMobileDetailOpen(false)}
                          className="min-h-[34px] text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          <span>กลับรายชื่อตึกทั้งหมด</span>
                        </button>
                      </div>

                      <div className="p-4 sm:p-5 space-y-5">
                        {/* Building Title & Actions */}
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
                            <button
                              type="button"
                              onClick={() =>
                                openEditBuildingModal(selectedBuilding)
                              }
                              title="แก้ไขชื่อและข้อมูลพื้นฐาน"
                              className="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">แก้ข้อมูลตึก</span>
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

                        {/* MULTI-PHOTO GALLERY MANAGER */}
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-700 inline-flex items-center gap-1.5">
                              <ImageIcon className="w-4 h-4 text-[#0F766E]" />
                              <span>
                                รูปภาพอาคาร ({selectedImages.length} รูป)
                              </span>
                            </span>

                            <div className="flex items-center gap-2">
                              <label className="min-h-[34px] px-3 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5 cursor-pointer">
                                <Camera className="w-3.5 h-3.5" />
                                <span>ถ่ายรูป</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  disabled={Boolean(uploadProgressText)}
                                  onChange={(e) => {
                                    handleUploadMultiplePhotos(
                                      selectedBuilding,
                                      e.target.files
                                    );
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                              <label className="min-h-[34px] px-3 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                                {uploadProgressText ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Upload className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {uploadProgressText || "เพิ่มหลายรูป"}
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  disabled={Boolean(uploadProgressText)}
                                  onChange={(e) => {
                                    handleUploadMultiplePhotos(
                                      selectedBuilding,
                                      e.target.files
                                    );
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          {/* Main Active Photo Preview */}
                          <div className="relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 aspect-[16/9] max-h-[240px] w-full flex items-center justify-center">
                            {selectedImages[activePhotoIndex] ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={selectedImages[activePhotoIndex]}
                                  alt={selectedBuilding.name}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-slate-900/75 text-white text-[11px] font-bold backdrop-blur-xs">
                                  {activePhotoIndex === 0
                                    ? `รูปปก (${activePhotoIndex + 1}/${selectedImages.length})`
                                    : `รูปที่ ${activePhotoIndex + 1}/${selectedImages.length}`}
                                </div>
                                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
                                  {activePhotoIndex !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSetCoverPhoto(
                                          selectedBuilding,
                                          selectedImages[activePhotoIndex]
                                        )
                                      }
                                      className="h-8 px-2.5 rounded-lg bg-white/90 hover:bg-white text-slate-800 text-[11px] font-bold inline-flex items-center gap-1 shadow-xs cursor-pointer"
                                    >
                                      <Star className="w-3.5 h-3.5 text-amber-500" />
                                      <span>ตั้งเป็นรูปปก</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemovePhoto(
                                        selectedBuilding,
                                        selectedImages[activePhotoIndex]
                                      )
                                    }
                                    className="h-8 px-2.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white text-[11px] font-bold inline-flex items-center gap-1 shadow-xs cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>ลบรูปนี้</span>
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-col items-center gap-1.5 text-slate-400">
                                <ImageIcon className="w-8 h-8" />
                                <span className="text-xs font-medium">
                                  ยังไม่มีรูปภาพ
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Thumbnail Strip */}
                          {selectedImages.length > 1 && (
                            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                              {selectedImages.map((url, idx) => (
                                <button
                                  key={`${url}-${idx}`}
                                  type="button"
                                  onClick={() => setActivePhotoIndex(idx)}
                                  className={`relative w-16 h-12 rounded-xl overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${idx === activePhotoIndex
                                      ? "border-[#0F766E] ring-2 ring-teal-500/20"
                                      : "border-slate-200 opacity-75 hover:opacity-100"
                                    }`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt={`รูปที่ ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                  {idx === 0 && (
                                    <span className="absolute bottom-0 inset-x-0 bg-[#0F766E]/85 text-white text-[9px] font-bold text-center">
                                      ปก
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 3 Summary Stat Boxes + 3D Map Shortcut */}
                        <div className="grid grid-cols-3 gap-2.5">
                          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2.5 text-center">
                            <p className="font-heading text-sm font-bold text-[#0F172A] truncate">
                              {selectedBuilding.building_code ||
                                `BLD-${String(selectedBuilding.id).padStart(
                                  2,
                                  "0"
                                )}`}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              รหัสอาคาร
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2.5 text-center">
                            <p className="font-heading text-sm font-bold text-[#0F172A]">
                              {floorSections.length} ชั้น
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {selectedBuilding.floor_range || "จำนวนชั้น"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2.5 text-center">
                            <p className="font-heading text-sm font-bold text-[#0F172A]">
                              {selectedBuildingDeptsCount} ห้อง/แผนก
                            </p>
                            <p className="text-[11px] text-slate-500">
                              จุดให้บริการ
                            </p>
                          </div>
                        </div>

                        <Link
                          href={`/admin/map?focus_node=${selectedBuilding.id}`}
                          className="w-full min-h-[42px] rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-xs sm:text-sm font-bold text-[#0F766E] inline-flex items-center justify-center gap-2 transition-colors"
                        >
                          <Box className="w-4 h-4" />
                          <span>ดูตำแหน่งบนแผนที่ 3D</span>
                        </Link>

                        {/* FLOOR-BY-FLOOR ROOM / DEPARTMENT TAG BUILDER */}
                        <div className="space-y-3 pt-2 border-t border-slate-100">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Stethoscope className="w-4 h-4 text-[#0F766E]" />
                              <h3 className="font-heading text-sm font-bold text-[#0F172A]">
                                แผนกและห้องรายชั้น
                              </h3>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setAddingFloorOpen((v) => !v);
                                if (!newFloorDraft) {
                                  setNewFloorDraft(
                                    `ชั้น ${floorSections.length + 1}`
                                  );
                                }
                              }}
                              className="min-h-[34px] px-3 rounded-full bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>เพิ่มชั้น</span>
                            </button>
                          </div>

                          {/* Add New Floor Inline Box */}
                          {addingFloorOpen && (
                            <form
                              onSubmit={handleAddFloorCard}
                              className="rounded-xl bg-teal-50/70 border border-teal-200 p-3 flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={newFloorDraft}
                                onChange={(e) =>
                                  setNewFloorDraft(e.target.value)
                                }
                                placeholder="ระบุชื่อชั้น เช่น ชั้น G, ชั้น 1, ชั้น 2"
                                className="flex-1 min-h-[38px] px-3 rounded-lg bg-white border border-teal-200 text-sm focus:outline-none focus:border-[#0F766E]"
                                autoFocus
                              />
                              <button
                                type="submit"
                                className="min-h-[38px] px-4 rounded-lg bg-[#0F766E] text-white text-xs font-bold cursor-pointer"
                              >
                                สร้างชั้น
                              </button>
                              <button
                                type="button"
                                onClick={() => setAddingFloorOpen(false)}
                                className="w-9 h-9 rounded-lg hover:bg-teal-100 text-slate-600 flex items-center justify-center cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </form>
                          )}

                          {/* Floor Cards List */}
                          {floorSections.length === 0 ? (
                            <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-6 text-center space-y-2">
                              <p className="text-xs font-semibold text-slate-600">
                                ยังไม่มีข้อมูลชั้นและห้องในตึกนี้
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewFloorDraft("ชั้น 1");
                                  setAddingFloorOpen(true);
                                }}
                                className="min-h-[36px] px-4 rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>เริ่มเพิ่มชั้น 1</span>
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {floorSections.map(({ floor, items }) => {
                                const floorKey = `${selectedBuilding.id}::${floor}`;
                                const inputVal =
                                  quickRoomInputs[floorKey] ?? "";
                                const isAddingThis =
                                  savingFloorKey === floorKey;

                                return (
                                  <div
                                    key={floor}
                                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="px-2.5 py-1 rounded-lg bg-[#0F766E] text-white text-xs font-bold">
                                          {floor}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-500">
                                          {items.length} ห้อง/แผนก
                                        </span>
                                      </div>
                                    </div>

                                    {/* Distinct Room / Department Tags */}
                                    <div className="flex flex-wrap gap-1.5">
                                      {items.length === 0 ? (
                                        <span className="text-xs text-slate-400 italic">
                                          ยังไม่มีห้องในชั้นนี้ พิมพ์ด้านล่างเพื่อเพิ่มได้เลย
                                        </span>
                                      ) : (
                                        items.map((dept) => (
                                          <div
                                            key={dept.id}
                                            className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-xl bg-white border border-teal-200/90 text-xs font-bold text-slate-800 shadow-2xs"
                                          >
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setDeptModal({
                                                  id: dept.id,
                                                  node_id: dept.node_id,
                                                  name: dept.name,
                                                  floor: dept.floor || floor,
                                                  operating_hours:
                                                    dept.operating_hours || "",
                                                  phone: dept.phone || "",
                                                  keywords: dept.keywords || "",
                                                })
                                              }
                                              title="คลิกเพื่อแก้ไขเวลาทำการ/เบอร์โทร/คำค้นหา"
                                              className="hover:text-[#0F766E] transition-colors cursor-pointer text-left"
                                            >
                                              {dept.name}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setDeleteTarget({
                                                  kind: "department",
                                                  id: dept.id,
                                                  label: `${dept.name} (${floor})`,
                                                })
                                              }
                                              aria-label={`ลบ ${dept.name}`}
                                              className="w-5 h-5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-[#BE123C] flex items-center justify-center cursor-pointer"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        ))
                                      )}
                                    </div>

                                    {/* Inline Quick-Add Room Tag Bar */}
                                    <div className="flex items-center gap-1.5 pt-1">
                                      <input
                                        type="text"
                                        value={inputVal}
                                        onChange={(e) =>
                                          setQuickRoomInputs((prev) => ({
                                            ...prev,
                                            [floorKey]: e.target.value,
                                          }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleQuickAddRooms(
                                              selectedBuilding.id,
                                              floor
                                            );
                                          }
                                        }}
                                        placeholder={`เพิ่มห้อง/แผนกใน${floor} เช่น ห้องเอกซเรย์, ห้องผ่าตัด...`}
                                        className="flex-1 min-h-[36px] px-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#0F766E]"
                                      />
                                      <button
                                        type="button"
                                        disabled={
                                          isAddingThis || !inputVal.trim()
                                        }
                                        onClick={() =>
                                          handleQuickAddRooms(
                                            selectedBuilding.id,
                                            floor
                                          )
                                        }
                                        className="min-h-[36px] px-3 rounded-xl bg-teal-50 hover:bg-teal-100 disabled:opacity-50 border border-teal-200 text-xs font-bold text-[#0F766E] inline-flex items-center gap-1 cursor-pointer shrink-0"
                                      >
                                        {isAddingThis ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Plus className="w-3.5 h-3.5" />
                                        )}
                                        <span>เพิ่ม</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Service Status Selector */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
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
                                  className={`min-h-[40px] px-2.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${active
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
                      เลือกอาคารจากรายการด้านซ้ายเพื่อดูและแก้ไขรูปภาพ ชั้น
                      และห้อง/แผนก
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
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${sp.is_active
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
                  คำค้นหาเพิ่มเติม (คั่นด้วยจุลภาค)
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
                  placeholder="เช่น MICU, Stroke, หอผู้ป่วยใน"
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
                  placeholder="รายละเอียดทางเข้า ลิฟต์ หรือจุดสังเกตภายในตึก"
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
                  placeholder="เว้นว่างให้ระบบสร้างอัตโนมัติ"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    สีหลัก
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
                    สีพื้นป้าย
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

      {/* ==================== MODAL: EDIT DEPARTMENT DETAILS ==================== */}
      {deptModal && (
        <div className="fixed inset-0 z-[800] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDepartment}
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-heading text-base font-bold text-[#0F172A]">
                {deptModal.id ? "แก้ไขรายละเอียดห้อง/แผนก" : "เพิ่มห้อง/แผนก"}
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
                    placeholder="ชั้น 1"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-slate-200 focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ชื่อห้อง / แผนก *
                  </label>
                  <input
                    type="text"
                    required
                    value={deptModal.name}
                    onChange={(e) =>
                      setDeptModal({ ...deptModal, name: e.target.value })
                    }
                    placeholder="เช่น ห้องเอกซเรย์"
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
                    placeholder="จ.-ศ. 08:30 - 16:30 น."
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
                  placeholder="เช่น X-Ray, รังสี, เอ็กซ์เรย์"
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
                <span>บันทึก</span>
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
                  อาคารที่ตั้ง
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
                  ต้องการลบ &ldquo;{deleteTarget.label}&rdquo; ใช่หรือไม่?
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
