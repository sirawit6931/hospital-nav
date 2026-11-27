"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  Headphones,
  Image as ImageIcon,
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
  type Department,
  type MapNode,
  type ServicePoint,
  type UploadResponse,
} from "@/lib/api";

type DirectoryTab = "buildings" | "departments" | "service_points";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  emergency: "ฉุกเฉิน / สายด่วน",
  info: "ประชาสัมพันธ์",
  opd: "ผู้ป่วยนอก (OPD)",
  wheelchair: "รถเข็น / ผู้สูงอายุ",
  parking: "ลานจอดรถ",
  general: "บริการทั่วไป",
};

interface BuildingForm {
  id: number | null;
  name: string;
  keywords: string;
  indoor_guide: string;
  image_url: string;
  lat: number;
  lng: number;
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

interface DeleteModalState {
  entity: DirectoryTab;
  id: number;
  label: string;
}

export default function AdminDirectoryPage() {
  const [activeTab, setActiveTab] = useState<DirectoryTab>("buildings");
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchText, setSearchText] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<
    "all" | "no_photo" | "no_dept"
  >("all");
  const [deptNodeFilter, setDeptNodeFilter] = useState<string>("all");
  const [spTypeFilter, setSpTypeFilter] = useState<string>("all");

  // Modals
  const [buildingModal, setBuildingModal] = useState<BuildingForm | null>(null);
  const [deptModal, setDeptModal] = useState<DepartmentForm | null>(null);
  const [spModal, setSpModal] = useState<ServicePointForm | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const loadDirectoryData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nodesRes, deptsRes, spRes] = await Promise.all([
        api.get<MapNode[]>("/api/admin/nodes"),
        api.get<Department[]>("/api/admin/departments"),
        api.get<ServicePoint[]>("/api/admin/service-points"),
      ]);
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setDepartments(Array.isArray(deptsRes.data) ? deptsRes.data : []);
      setServicePoints(Array.isArray(spRes.data) ? spRes.data : []);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถโหลดข้อมูลไดเรกทอรีได้"));
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDirectoryData();
  }, [loadDirectoryData]);

  const buildings = useMemo(
    () => nodes.filter((n) => n.is_building),
    [nodes]
  );

  const buildingNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of nodes) m.set(n.id, n.name || `จุด #${n.id}`);
    return m;
  }, [nodes]);

  const deptCountByNodeId = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of departments) {
      m.set(d.node_id, (m.get(d.node_id) || 0) + 1);
    }
    return m;
  }, [departments]);

  const qLower = searchText.trim().toLowerCase();

  const filteredBuildings = useMemo(() => {
    return buildings.filter((b) => {
      if (buildingFilter === "no_photo" && b.image_url?.trim()) return false;
      if (
        buildingFilter === "no_dept" &&
        (deptCountByNodeId.get(b.id) || 0) > 0
      )
        return false;
      if (!qLower) return true;
      return `${b.name} ${b.keywords} ${b.indoor_guide}`
        .toLowerCase()
        .includes(qLower);
    });
  }, [buildings, buildingFilter, deptCountByNodeId, qLower]);

  const filteredDepartments = useMemo(() => {
    return departments.filter((d) => {
      if (deptNodeFilter !== "all" && String(d.node_id) !== deptNodeFilter) {
        return false;
      }
      if (!qLower) return true;
      const bName = buildingNameById.get(d.node_id) || "";
      return `${d.name} ${d.floor} ${d.keywords} ${d.phone} ${bName}`
        .toLowerCase()
        .includes(qLower);
    });
  }, [departments, deptNodeFilter, buildingNameById, qLower]);

  const filteredServicePoints = useMemo(() => {
    return servicePoints.filter((sp) => {
      if (spTypeFilter !== "all" && sp.type !== spTypeFilter) return false;
      if (!qLower) return true;
      const bName = sp.node_id ? buildingNameById.get(sp.node_id) || "" : "";
      return `${sp.name} ${sp.description} ${sp.phone} ${sp.type} ${bName}`
        .toLowerCase()
        .includes(qLower);
    });
  }, [servicePoints, spTypeFilter, buildingNameById, qLower]);

  const handleUploadBuildingPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !buildingModal) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post<UploadResponse>("/api/admin/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBuildingModal((prev) =>
        prev ? { ...prev, image_url: res.data.image_url || res.data.url } : null
      );
      showToast("success", "อัปโหลดรูปหน้าอาคารเรียบร้อยแล้ว");
    } catch (err) {
      showToast("error", extractApiError(err, "อัปโหลดรูปภาพไม่สำเร็จ"));
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleSaveBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingModal) return;
    setIsSaving(true);
    try {
      const payload = {
        name: buildingModal.name.trim(),
        is_building: true,
        keywords: buildingModal.keywords.trim(),
        indoor_guide: buildingModal.indoor_guide.trim(),
        image_url: buildingModal.image_url.trim(),
        lat: Number(buildingModal.lat),
        lng: Number(buildingModal.lng),
      };
      if (buildingModal.id) {
        const res = await api.put<MapNode>(
          `/api/admin/nodes/${buildingModal.id}`,
          payload
        );
        setNodes((prev) =>
          prev.map((n) => (n.id === res.data.id ? res.data : n))
        );
        showToast("success", `อัปเดตข้อมูลอาคาร "${res.data.name}" เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<MapNode>("/api/admin/nodes", payload);
        setNodes((prev) => [...prev, res.data]);
        showToast("success", `เพิ่มอาคาร "${res.data.name}" เรียบร้อยแล้ว`);
      }
      setBuildingModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกข้อมูลอาคารได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptModal) return;
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
        const res = await api.put<Department>(
          `/api/admin/departments/${deptModal.id}`,
          payload
        );
        setDepartments((prev) =>
          prev.map((d) => (d.id === res.data.id ? res.data : d))
        );
        showToast("success", `อัปเดตแผนก "${res.data.name}" เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<Department>(
          "/api/admin/departments",
          payload
        );
        setDepartments((prev) => [...prev, res.data]);
        showToast("success", `เพิ่มแผนก "${res.data.name}" เรียบร้อยแล้ว`);
      }
      setDeptModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกข้อมูลแผนกได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveServicePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spModal) return;
    setIsSaving(true);
    try {
      const payload = {
        node_id: spModal.node_id ? Number(spModal.node_id) : null,
        type: spModal.type,
        name: spModal.name.trim(),
        description: spModal.description.trim(),
        phone: spModal.phone.trim(),
        is_active: spModal.is_active,
      };
      if (spModal.id) {
        const res = await api.put<ServicePoint>(
          `/api/admin/service-points/${spModal.id}`,
          payload
        );
        setServicePoints((prev) =>
          prev.map((s) => (s.id === res.data.id ? res.data : s))
        );
        showToast("success", `อัปเดตจุดบริการ "${res.data.name}" เรียบร้อยแล้ว`);
      } else {
        const res = await api.post<ServicePoint>(
          "/api/admin/service-points",
          payload
        );
        setServicePoints((prev) => [...prev, res.data]);
        showToast("success", `เพิ่มจุดบริการ "${res.data.name}" เรียบร้อยแล้ว`);
      }
      setSpModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ไม่สามารถบันทึกจุดบริการได้"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);
    try {
      if (deleteModal.entity === "buildings") {
        await api.delete(`/api/admin/nodes/${deleteModal.id}`);
        setNodes((prev) => prev.filter((n) => n.id !== deleteModal.id));
        setDepartments((prev) =>
          prev.filter((d) => d.node_id !== deleteModal.id)
        );
        setServicePoints((prev) =>
          prev.map((s) =>
            s.node_id === deleteModal.id ? { ...s, node_id: null } : s
          )
        );
      } else if (deleteModal.entity === "departments") {
        await api.delete(`/api/admin/departments/${deleteModal.id}`);
        setDepartments((prev) => prev.filter((d) => d.id !== deleteModal.id));
      } else {
        await api.delete(`/api/admin/service-points/${deleteModal.id}`);
        setServicePoints((prev) => prev.filter((s) => s.id !== deleteModal.id));
      }
      showToast("success", `ลบ "${deleteModal.label}" เรียบร้อยแล้ว`);
      setDeleteModal(null);
    } catch (err) {
      showToast("error", extractApiError(err, "ลบข้อมูลไม่สำเร็จ"));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenAddModal = () => {
    if (activeTab === "buildings") {
      setBuildingModal({
        id: null,
        name: "",
        keywords: "",
        indoor_guide: "",
        image_url: "",
        lat: 17.1633,
        lng: 104.1581,
      });
    } else if (activeTab === "departments") {
      const defaultNodeId = buildings[0]?.id ?? 0;
      setDeptModal({
        id: null,
        node_id: defaultNodeId,
        name: "",
        floor: "",
        operating_hours: "จ.-ศ. 08:30 - 16:30 น.",
        phone: "042-176-000",
        keywords: "",
      });
    } else {
      setSpModal({
        id: null,
        node_id: null,
        type: "general",
        name: "",
        description: "",
        phone: "",
        is_active: true,
      });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-[#0F172A]">
            จัดการอาคาร แผนก และจุดบริการ
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            เพิ่ม แก้ไข ลบ และอัปโหลดรูปหน้าอาคารในรูปแบบตารางได้สะดวกรวดเร็ว
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadDirectoryData}
            disabled={isLoading}
            className="min-h-[42px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            <span>รีเฟรช</span>
          </button>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="min-h-[42px] px-4 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>
              {activeTab === "buildings"
                ? "เพิ่มอาคารใหม่"
                : activeTab === "departments"
                ? "เพิ่มแผนก/คลินิก"
                : "เพิ่มจุดบริการ"}
            </span>
          </button>
        </div>
      </div>

      {/* 3-Tab Switcher + Search/Filters */}
      <div className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("buildings")}
            className={`min-h-[40px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === "buildings"
                ? "bg-[#0F766E] text-white shadow-xs"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>อาคาร ({buildings.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("departments")}
            className={`min-h-[40px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === "departments"
                ? "bg-[#0F766E] text-white shadow-xs"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            <span>แผนก / คลินิก ({departments.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("service_points")}
            className={`min-h-[40px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === "service_points"
                ? "bg-[#0F766E] text-white shadow-xs"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Headphones className="w-4 h-4" />
            <span>จุดบริการ ({servicePoints.length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="ค้นหาชื่อ, คำค้นหา, ชั้น, เบอร์โทร..."
              className="w-full min-h-[40px] pl-9 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:outline-none focus:border-[#0F766E]"
            />
          </div>

          {activeTab === "buildings" && (
            <select
              value={buildingFilter}
              onChange={(e) =>
                setBuildingFilter(
                  e.target.value as "all" | "no_photo" | "no_dept"
                )
              }
              className="min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0F766E]"
            >
              <option value="all">แสดงอาคารทั้งหมด</option>
              <option value="no_photo">เฉพาะตึกที่ยังไม่มีรูป</option>
              <option value="no_dept">เฉพาะตึกที่ยังไม่มีแผนก</option>
            </select>
          )}

          {activeTab === "departments" && (
            <select
              value={deptNodeFilter}
              onChange={(e) => setDeptNodeFilter(e.target.value)}
              className="min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0F766E] max-w-xs"
            >
              <option value="all">ทุกอาคาร</option>
              {buildings.map((b) => (
                <option key={`filter-b-${b.id}`} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {activeTab === "service_points" && (
            <select
              value={spTypeFilter}
              onChange={(e) => setSpTypeFilter(e.target.value)}
              className="min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0F766E]"
            >
              <option value="all">ทุกประเภทบริการ</option>
              {Object.entries(SERVICE_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
        {isLoading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin text-[#0F766E]" />
            <span className="text-sm">กำลังโหลดตารางข้อมูล...</span>
          </div>
        ) : activeTab === "buildings" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 w-20">รูป</th>
                  <th className="py-3 px-4">ชื่ออาคาร</th>
                  <th className="py-3 px-4">แผนกในตึก</th>
                  <th className="py-3 px-4">พิกัด (Lat, Lng)</th>
                  <th className="py-3 px-4 text-right w-32">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredBuildings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 text-center text-slate-500 text-sm"
                    >
                      ไม่พบอาคารที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  filteredBuildings.map((b) => {
                    const deptCnt = deptCountByNodeId.get(b.id) || 0;
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          {b.image_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={b.image_url}
                              alt={b.name}
                              className="w-12 h-10 rounded-lg object-cover border border-slate-200"
                            />
                          ) : (
                            <div className="w-12 h-10 rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-bold text-[#0F172A]">
                            #{b.id} {b.name}
                          </p>
                          {b.keywords && (
                            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5 max-w-md">
                              {b.keywords}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              deptCnt > 0
                                ? "bg-teal-50 text-[#0F766E]"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {deptCnt} แผนก
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">
                          {b.lat.toFixed(5)}, {b.lng.toFixed(5)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setBuildingModal({
                                  id: b.id,
                                  name: b.name,
                                  keywords: b.keywords || "",
                                  indoor_guide: b.indoor_guide || "",
                                  image_url: b.image_url || "",
                                  lat: b.lat,
                                  lng: b.lng,
                                })
                              }
                              title="แก้ไขอาคาร"
                              className="w-9 h-9 rounded-lg hover:bg-teal-50 text-[#0F766E] flex items-center justify-center cursor-pointer"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteModal({
                                  entity: "buildings",
                                  id: b.id,
                                  label: `อาคาร #${b.id} ${b.name}`,
                                })
                              }
                              title="ลบอาคาร"
                              className="w-9 h-9 rounded-lg hover:bg-rose-50 text-[#BE123C] flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "departments" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4">ชื่อแผนก / คลินิก</th>
                  <th className="py-3 px-4">อาคารที่ตั้ง</th>
                  <th className="py-3 px-4">ชั้น</th>
                  <th className="py-3 px-4">เวลาทำการ / โทร</th>
                  <th className="py-3 px-4 text-right w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredDepartments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 text-center text-slate-500 text-sm"
                    >
                      ไม่พบข้อมูลแผนกที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  filteredDepartments.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <p className="font-bold text-[#0F172A]">{d.name}</p>
                        {d.keywords && (
                          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                            {d.keywords}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                        {buildingNameById.get(d.node_id) || `Node #${d.node_id}`}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-bold">
                          {d.floor || "-"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 space-y-0.5">
                        {d.operating_hours && (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{d.operating_hours}</span>
                          </div>
                        )}
                        {d.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span>{d.phone}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setDeptModal({
                                id: d.id,
                                node_id: d.node_id,
                                name: d.name,
                                floor: d.floor || "",
                                operating_hours: d.operating_hours || "",
                                phone: d.phone || "",
                                keywords: d.keywords || "",
                              })
                            }
                            className="w-9 h-9 rounded-lg hover:bg-teal-50 text-[#0F766E] flex items-center justify-center cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteModal({
                                entity: "departments",
                                id: d.id,
                                label: d.name,
                              })
                            }
                            className="w-9 h-9 rounded-lg hover:bg-rose-50 text-[#BE123C] flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4">ชื่อจุดบริการ</th>
                  <th className="py-3 px-4">ประเภท</th>
                  <th className="py-3 px-4">อาคารที่ผูก</th>
                  <th className="py-3 px-4">เบอร์โทร / สถานะ</th>
                  <th className="py-3 px-4 text-right w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredServicePoints.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 text-center text-slate-500 text-sm"
                    >
                      ไม่พบจุดบริการที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  filteredServicePoints.map((sp) => (
                    <tr key={sp.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <p className="font-bold text-[#0F172A]">{sp.name}</p>
                        {sp.description && (
                          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5 max-w-md">
                            {sp.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex px-2.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-xs font-bold">
                          {SERVICE_TYPE_LABELS[sp.type] || sp.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        {sp.node_id
                          ? buildingNameById.get(sp.node_id) ||
                            `Node #${sp.node_id}`
                          : "ไม่ผูกอาคาร"}
                      </td>
                      <td className="py-3 px-4 space-y-1">
                        {sp.phone && (
                          <p className="text-xs font-semibold text-slate-700">
                            {sp.phone}
                          </p>
                        )}
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            sp.is_active
                              ? "bg-[#CCFBF1] text-[#047857]"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {sp.is_active ? "เปิดแสดงผล" : "ซ่อนชั่วคราว"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setSpModal({
                                id: sp.id,
                                node_id: sp.node_id,
                                type: sp.type,
                                name: sp.name,
                                description: sp.description || "",
                                phone: sp.phone || "",
                                is_active: sp.is_active,
                              })
                            }
                            className="w-9 h-9 rounded-lg hover:bg-teal-50 text-[#0F766E] flex items-center justify-center cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteModal({
                                entity: "service_points",
                                id: sp.id,
                                label: sp.name,
                              })
                            }
                            className="w-9 h-9 rounded-lg hover:bg-rose-50 text-[#BE123C] flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Building Add/Edit Modal */}
      {buildingModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {buildingModal.id
                  ? `แก้ไขอาคาร #${buildingModal.id}`
                  : "เพิ่มอาคารใหม่"}
              </h2>
              <button
                type="button"
                onClick={() => setBuildingModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBuilding} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  ชื่ออาคาร *
                </label>
                <input
                  type="text"
                  required
                  value={buildingModal.name}
                  onChange={(e) =>
                    setBuildingModal({ ...buildingModal, name: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    Latitude *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={buildingModal.lat}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        lat: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    Longitude *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={buildingModal.lng}
                    onChange={(e) =>
                      setBuildingModal({
                        ...buildingModal,
                        lng: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm font-mono focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  คำค้นหา (Keywords)
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
                  placeholder="เช่น OPD, MICU, ฟอกไต, ห้องยา"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  คำแนะนำการเดินภายในอาคาร (Indoor Guide)
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
                  className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">
                  รูปภาพหน้าอาคาร
                </label>
                <div className="flex items-center gap-3">
                  <label className="min-h-[40px] px-3.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-[#0F766E] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>อัปโหลดรูปภาพ</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadBuildingPhoto}
                      className="hidden"
                    />
                  </label>
                  {buildingModal.image_url && (
                    <button
                      type="button"
                      onClick={() =>
                        setBuildingModal({ ...buildingModal, image_url: "" })
                      }
                      className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
                    >
                      ลบรูป
                    </button>
                  )}
                </div>
                {buildingModal.image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={buildingModal.image_url}
                    alt="ตัวอย่างรูปอาคาร"
                    className="w-full h-36 object-cover rounded-xl border border-slate-200"
                  />
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setBuildingModal(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[42px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>บันทึกข้อมูลอาคาร</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department Add/Edit Modal */}
      {deptModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {deptModal.id ? "แก้ไขข้อมูลแผนก/คลินิก" : "เพิ่มแผนก/คลินิกใหม่"}
              </h2>
              <button
                type="button"
                onClick={() => setDeptModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveDepartment} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  สังกัดอาคาร *
                </label>
                <select
                  required
                  value={deptModal.node_id}
                  onChange={(e) =>
                    setDeptModal({
                      ...deptModal,
                      node_id: Number(e.target.value),
                    })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                >
                  {buildings.map((b) => (
                    <option key={`dm-b-${b.id}`} value={b.id}>
                      #{b.id} {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  ชื่อแผนก / คลินิก *
                </label>
                <input
                  type="text"
                  required
                  value={deptModal.name}
                  onChange={(e) =>
                    setDeptModal({ ...deptModal, name: e.target.value })
                  }
                  placeholder="เช่น คลินิกโรคหัวใจ, ห้องเจาะเลือด"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">ชั้น</label>
                  <input
                    type="text"
                    value={deptModal.floor}
                    onChange={(e) =>
                      setDeptModal({ ...deptModal, floor: e.target.value })
                    }
                    placeholder="เช่น ชั้น 2"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    เบอร์โทรศัพท์
                  </label>
                  <input
                    type="text"
                    value={deptModal.phone}
                    onChange={(e) =>
                      setDeptModal({ ...deptModal, phone: e.target.value })
                    }
                    placeholder="เช่น 042-176-000"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
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
                  placeholder="เช่น จ.-ศ. 08:30 - 16:30 น."
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  คำค้นหาเพิ่มเติม
                </label>
                <input
                  type="text"
                  value={deptModal.keywords}
                  onChange={(e) =>
                    setDeptModal({ ...deptModal, keywords: e.target.value })
                  }
                  placeholder="คั่นด้วยจุลภาค เช่น หัวใจ, EKG, ตรวจคลื่นหัวใจ"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDeptModal(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[42px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>บันทึกแผนก</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Service Point Add/Edit Modal */}
      {spModal && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-heading text-base font-bold text-[#0F172A]">
                {spModal.id ? "แก้ไขจุดบริการ" : "เพิ่มจุดบริการใหม่"}
              </h2>
              <button
                type="button"
                onClick={() => setSpModal(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveServicePoint} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  ชื่อจุดบริการ *
                </label>
                <input
                  type="text"
                  required
                  value={spModal.name}
                  onChange={(e) =>
                    setSpModal({ ...spModal, name: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    ประเภท
                  </label>
                  <select
                    value={spModal.type}
                    onChange={(e) =>
                      setSpModal({ ...spModal, type: e.target.value })
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                  >
                    {Object.entries(SERVICE_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">
                    เบอร์โทรศัพท์
                  </label>
                  <input
                    type="text"
                    value={spModal.phone}
                    onChange={(e) =>
                      setSpModal({ ...spModal, phone: e.target.value })
                    }
                    placeholder="เช่น 1669 หรือ 042-176-000"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  ผูกกับอาคาร (ไม่บังคับ)
                </label>
                <select
                  value={spModal.node_id ? String(spModal.node_id) : ""}
                  onChange={(e) =>
                    setSpModal({
                      ...spModal,
                      node_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                >
                  <option value="">-- ไม่ผูกอาคาร --</option>
                  {buildings.map((b) => (
                    <option key={`sp-b-${b.id}`} value={String(b.id)}>
                      #{b.id} {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  รายละเอียด
                </label>
                <textarea
                  rows={3}
                  value={spModal.description}
                  onChange={(e) =>
                    setSpModal({ ...spModal, description: e.target.value })
                  }
                  className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={spModal.is_active}
                  onChange={(e) =>
                    setSpModal({ ...spModal, is_active: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#0F766E]"
                />
                <span>เปิดแสดงผลบนหน้าผู้ใช้</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSpModal(null)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[42px] px-5 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>บันทึกจุดบริการ</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-[1150] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-heading text-base font-bold text-[#BE123C]">
              ยืนยันการลบข้อมูล
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              คุณต้องการลบ <strong>{deleteModal.label}</strong> ใช่หรือไม่?
              {deleteModal.entity === "buildings" &&
                " (ระบบจะลบเส้นเชื่อมและแผนกที่ผูกกับอาคารนี้ออกด้วยอย่างปลอดภัย)"}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
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
          className={`fixed bottom-5 right-5 z-[1200] max-w-sm rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-semibold ${
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
