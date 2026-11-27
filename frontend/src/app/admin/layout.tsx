"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Building2,
  Compass,
  ExternalLink,
  History,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { api, type AdminMeResponse } from "@/lib/api";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface AdminNavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: typeof Building2;
  exact?: boolean;
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    href: "/admin",
    label: "ข้อมูลตึก & แผนก",
    shortLabel: "ข้อมูลตึก",
    icon: Building2,
    exact: true,
  },
  {
    href: "/admin/survey",
    label: "เก็บพิกัดภาคสนาม",
    shortLabel: "เก็บพิกัด",
    icon: Compass,
  },
  {
    href: "/admin/map",
    label: "แก้ไขแผนที่ 3D",
    shortLabel: "แผนที่ 3D",
    icon: Box,
  },
  {
    href: "/admin/settings",
    label: "ประกาศ & QR Code",
    shortLabel: "ประกาศ/QR",
    icon: Megaphone,
  },
  {
    href: "/admin/history",
    label: "ประวัติการแก้ไข",
    shortLabel: "ประวัติ",
    icon: History,
  },
];

const MOBILE_BOTTOM_TABS: AdminNavItem[] = [
  ADMIN_NAV_ITEMS[0], // ข้อมูลตึก
  ADMIN_NAV_ITEMS[1], // เก็บพิกัด
  ADMIN_NAV_ITEMS[2], // แผนที่ 3D
  ADMIN_NAV_ITEMS[4], // ประวัติ
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/admin/login";

  const [authChecked, setAuthChecked] = useState(isLoginPage);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const isSurveyRecordingRef = useRef<boolean>(false);

  const handleLogout = useCallback(async () => {
    try {
      await api.post("/api/admin/logout");
    } catch {
      // Proceed to login screen even if network fails
    }
    router.replace("/admin/login");
  }, [router]);

  // Verify HttpOnly session cookie via GET /api/admin/me whenever entering /admin zone
  useEffect(() => {
    if (isLoginPage) {
      setAuthChecked(true);
      return;
    }
    let cancelled = false;
    api
      .get<AdminMeResponse>("/api/admin/me")
      .then((res) => {
        if (!cancelled) {
          if (res.data?.admin) {
            setAuthChecked(true);
          } else {
            router.replace("/admin/login");
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          router.replace("/admin/login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, pathname, router]);

  // Track active GPS recording state from /admin/survey so Idle Timeout never interrupts field recording
  useEffect(() => {
    const onRecordingState = (ev: Event) => {
      const custom = ev as CustomEvent<{ recording?: boolean }>;
      isSurveyRecordingRef.current = Boolean(custom.detail?.recording);
      if (isSurveyRecordingRef.current) {
        lastActivityRef.current = Date.now();
      }
    };
    window.addEventListener("admin-survey-recording-state", onRecordingState);
    return () => {
      window.removeEventListener(
        "admin-survey-recording-state",
        onRecordingState
      );
    };
  }, []);

  // 30-Minute Idle Timeout (paused while actively recording GPS on /admin/survey)
  useEffect(() => {
    if (isLoginPage || !authChecked) return;

    lastActivityRef.current = Date.now();
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    events.forEach((evt) =>
      window.addEventListener(evt, markActivity, { passive: true })
    );

    const interval = setInterval(() => {
      if (isSurveyRecordingRef.current) {
        lastActivityRef.current = Date.now();
        return;
      }
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        handleLogout();
      }
    }, 30000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, markActivity));
      clearInterval(interval);
    };
  }, [isLoginPage, authChecked, handleLogout]);

  useEffect(() => {
    setMobileMenuOpen(false);
    // Reset full-screen sidebar hiding when leaving /admin/map
    if (!pathname.startsWith("/admin/map")) {
      setSidebarHidden(false);
    }
  }, [pathname]);

  // Listen for fullscreen toggle events from /admin/map and notify listeners + trigger map resize
  useEffect(() => {
    const handleToggle = () => setSidebarHidden((prev) => !prev);
    const handleSet = (ev: Event) => {
      const custom = ev as CustomEvent<{ hidden?: boolean }>;
      if (typeof custom.detail?.hidden === "boolean") {
        setSidebarHidden(custom.detail.hidden);
      }
    };
    window.addEventListener("admin-sidebar-toggle", handleToggle);
    window.addEventListener("admin-sidebar-set-hidden", handleSet);
    return () => {
      window.removeEventListener("admin-sidebar-toggle", handleToggle);
      window.removeEventListener("admin-sidebar-set-hidden", handleSet);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-state", { detail: { hidden: sidebarHidden } })
    );
    const t1 = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    const t2 = setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [sidebarCollapsed, sidebarHidden]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!authChecked) {
    return (
      <div className="h-dvh bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#0F766E]" />
      </div>
    );
  }

  const isActiveRoute = (item: AdminNavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  const activeNav =
    ADMIN_NAV_ITEMS.find((item) => isActiveRoute(item)) ?? ADMIN_NAV_ITEMS[0];

  const renderSidebarLinks = (collapsed: boolean) => (
    <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
      {ADMIN_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActiveRoute(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={`min-h-[44px] px-3 rounded-xl flex items-center gap-3 text-sm font-semibold transition-colors ${active
                ? "bg-[#0F766E] text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-100 hover:text-[#0F172A]"
              } ${collapsed ? "justify-center px-0" : ""}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="h-dvh w-full flex flex-col md:flex-row overflow-hidden bg-[#F8FAFC]">
      {/* Desktop Collapsible Sidebar (hidden when full-screen map mode is active) */}
      {!sidebarHidden && (
        <aside
          className={`hidden md:flex shrink-0 h-full flex-col bg-white border-r border-slate-200 transition-all duration-200 ${sidebarCollapsed ? "w-[72px]" : "w-64"
            }`}
        >
          <div className="shrink-0 h-16 px-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <Link
              href="/admin"
              className={`flex items-center gap-2.5 min-w-0 ${sidebarCollapsed ? "justify-center w-full" : ""
                }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/sakon-hospital-logo.png"
                alt="โลโก้โรงพยาบาลสกลนคร"
                className="h-9 w-auto object-contain shrink-0"
              />
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="font-heading text-sm font-bold text-[#0F172A] truncate leading-tight">
                    รพ.สกลนคร
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    ผู้ดูแลระบบ
                  </p>
                </div>
              )}
            </Link>

            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                title="พับแถบเมนูซ้าย"
                aria-label="พับแถบเมนูซ้าย"
                className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 cursor-pointer"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}
          </div>

          {sidebarCollapsed && (
            <div className="px-2.5 pt-2.5 flex justify-center">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                title="กางแถบเมนูซ้าย"
                aria-label="กางแถบเมนูซ้าย"
                className="w-10 h-10 rounded-xl hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </div>
          )}

          {renderSidebarLinks(sidebarCollapsed)}

          <div className="shrink-0 p-2.5 border-t border-slate-200 space-y-1.5">
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              title={sidebarCollapsed ? "เปิดหน้าผู้ใช้ทั่วไป (แท็บใหม่)" : undefined}
              className={`min-h-[40px] px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-teal-50 hover:border-teal-200 text-xs font-semibold text-slate-700 flex items-center gap-2.5 transition-colors ${sidebarCollapsed ? "justify-center px-0" : ""
                }`}
            >
              <ExternalLink className="w-4 h-4 text-[#0F766E] shrink-0" />
              {!sidebarCollapsed && <span>เปิดหน้าแผนที่ผู้ใช้</span>}
            </a>

            <button
              type="button"
              onClick={handleLogout}
              title={sidebarCollapsed ? "ออกจากระบบ" : undefined}
              className={`w-full min-h-[40px] px-3 rounded-xl border border-rose-200 bg-[#FFE4E6]/60 hover:bg-[#FFE4E6] text-xs font-bold text-[#BE123C] flex items-center gap-2.5 transition-colors cursor-pointer ${sidebarCollapsed ? "justify-center px-0" : ""
                }`}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>ออกจากระบบ</span>}
            </button>
          </div>
        </aside>
      )}

      {/* Mobile Top Bar (hidden when full-screen map mode is active) */}
      {!sidebarHidden && (
        <header className="md:hidden shrink-0 h-14 px-3 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="เปิดเมนูผู้ดูแลระบบ"
              className="w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center shrink-0 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sakon-hospital-logo.png"
              alt="โลโก้โรงพยาบาลสกลนคร"
              className="h-8 w-auto object-contain shrink-0"
            />
            <span className="font-heading text-sm font-bold text-[#0F172A] truncate">
              {activeNav.shortLabel}
            </span>
          </div>

          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#0F766E]" />
            <span>หน้าผู้ใช้</span>
          </a>
        </header>
      )}

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[1200] flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[82vw] h-full bg-white shadow-2xl flex flex-col">
            <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/sakon-hospital-logo.png"
                  alt="โลโก้โรงพยาบาลสกลนคร"
                  className="h-8 w-auto object-contain"
                />
                <span className="font-heading text-sm font-bold text-[#0F172A]">
                  รพ.สกลนคร Admin
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="ปิดเมนู"
                className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderSidebarLinks(false)}
            <div className="p-3 border-t border-slate-200 space-y-2">
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[42px] px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4 text-[#0F766E]" />
                <span>เปิดหน้าแผนที่ผู้ใช้</span>
              </a>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[42px] px-3 rounded-xl border border-rose-200 bg-[#FFE4E6]/70 text-xs font-bold text-[#BE123C] flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>ออกจากระบบ</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Slot */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {children}
      </div>

      {/* Mobile Bottom Navigation Bar */}
      {!sidebarHidden && (
        <nav
          aria-label="แถบเมนูล่างผู้ดูแลระบบ"
          className="md:hidden shrink-0 bg-white border-t border-slate-200 px-2 py-1.5 grid grid-cols-4 gap-1 shadow-[0_-2px_10px_rgba(15,23,42,0.06)] z-[600]"
        >
          {MOBILE_BOTTOM_TABS.map((item) => {
            const Icon = item.icon;
            const active = isActiveRoute(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`min-h-[50px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${active
                    ? "bg-[#CCFBF1] text-[#0F766E]"
                    : "text-slate-600 hover:bg-slate-50"
                  }`}
              >
                <Icon className="w-5 h-5" />
                <span className="truncate">{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
