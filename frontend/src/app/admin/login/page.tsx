"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldAlert,
  User,
} from "lucide-react";
import {
  api,
  extractApiError,
  setAdminToken,
  type LoginResponse,
} from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password) {
      setErrorMessage("กรุณากรอกชื่อผู้ใช้งานและรหัสผ่านให้ครบถ้วน");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post<LoginResponse>("/api/admin/login", {
        username: username.trim(),
        password,
      });
      if (res.data?.token) {
        setAdminToken(res.data.token);
        router.replace("/admin/map");
      } else {
        setErrorMessage("ไม่ได้รับโทเคนยืนยันตัวตนจากระบบ");
      }
    } catch (err) {
      setErrorMessage(
        extractApiError(err, "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#F8FAFC] flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-md w-full mx-auto pt-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 min-h-[44px] px-3 -ml-3 rounded-xl text-sm font-semibold text-slate-600 hover:text-[#0F766E] hover:bg-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>กลับหน้าแผนที่นำทาง</span>
        </Link>
      </div>

      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="rounded-3xl bg-white border border-slate-200 shadow-[0_8px_30px_rgba(15,23,42,0.06)] p-6 sm:p-8 space-y-6">
          {/* Official Hospital Emblem */}
          <div className="text-center space-y-3">
            <div className="h-20 mx-auto flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/sakon-hospital-logo.png"
                alt="โลโก้โรงพยาบาลสกลนคร"
                className="h-20 w-auto object-contain"
              />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold text-[#0F172A]">
                ระบบจัดการแผนที่นำทาง
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                โรงพยาบาลสกลนคร • สำหรับเจ้าหน้าที่ดูแลระบบ
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl bg-[#FFE4E6] border border-rose-200 px-4 py-3 flex items-start gap-2.5 text-sm text-[#BE123C]">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="font-medium leading-snug">{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-username"
                className="block text-sm font-semibold text-slate-700"
              >
                ชื่อผู้ใช้งาน (Username)
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="กรอกชื่อผู้ใช้งาน"
                  className="w-full min-h-[48px] pl-11 pr-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-teal-600/15"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="admin-password"
                className="block text-sm font-semibold text-slate-700"
              >
                รหัสผ่าน (Password)
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่าน"
                  className="w-full min-h-[48px] pl-11 pr-12 rounded-xl bg-slate-50 border border-slate-200 text-sm text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-teal-600/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  className="w-10 h-10 rounded-lg text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[48px] rounded-xl bg-[#0F766E] hover:bg-[#115E59] active:bg-[#134E4A] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer mt-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังตรวจสอบสิทธิ์...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>เข้าสู่ระบบผู้ดูแล</span>
                </>
              )}
            </button>
          </form>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 pb-2">
        ระบบนำทางอาคารและแผนกบริการ โรงพยาบาลสกลนคร
      </footer>
    </div>
  );
}
