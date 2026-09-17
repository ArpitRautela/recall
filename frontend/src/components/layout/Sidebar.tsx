"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { authService } from "@/services/auth";

const NAV_ITEMS = [
  { icon: "add_comment", label: "New Chat",      href: "/chat/new" },
  { icon: "history",     label: "Recent Chats",  href: "/dashboard" },
  { icon: "folder",      label: "Files",          href: "/vault" },
  { icon: "search",      label: "Search",         href: "/search" },
  { icon: "psychology",  label: "Memories",       href: "/memories" },
  { icon: "settings",    label: "Settings",       href: "/settings" },
];

/**
 * The sidebar body. Rendered twice: as a permanent column on large screens, and
 * inside a Sheet drawer below `lg`. Kept as one component so the two can't drift.
 */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();

  const handleLogout = async () => {
    await authService.logout();
    clearAuth();
    router.replace("/login");
  };

  const initials = user?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "U";

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 mb-2 shrink-0">
        <div
          className="w-8 h-8 rounded flex items-center justify-center shrink-0"
          style={{ background: "#ffffff" }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 20,
              color: "#2f3131",
              fontVariationSettings: "'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 20",
            }}
          >
            memory
          </span>
        </div>
        <div className="flex flex-col">
          <span
            className="font-extrabold text-[#ffffff] leading-none"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            RECALL
          </span>
          <span
            className="leading-none mt-0.5"
            style={{ fontSize: 10, letterSpacing: "0.08em", color: "#8e9192" }}
          >
            AI PRODUCTIVITY PLATFORM
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-1 overflow-y-auto space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && item.href !== "/chat/new" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                color: isActive ? "#e5e2e1" : "#c4c7c8",
                borderLeft: isActive ? "2px solid #e5e2e1" : "2px solid transparent",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                {item.icon}
              </span>
              <span style={{ fontSize: 14, lineHeight: "20px", letterSpacing: "-0.006em" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Upgrade card */}
      <div
        className="mx-4 my-3 p-4 rounded-xl shrink-0"
        style={{
          background: "rgba(49,49,192,0.1)",
          border: "1px solid rgba(49,49,192,0.2)",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wider mb-2"
          style={{ color: "#c0c1ff", letterSpacing: "0.08em" }}
        >
          Premium Plan
        </p>
        <p className="text-xs leading-relaxed mb-4" style={{ color: "#c4c7c8" }}>
          Get unlimited memory and advanced reasoning models.
        </p>
        <button
          className="w-full py-2 rounded text-xs font-bold transition-opacity hover:opacity-90"
          style={{ background: "#ffffff", color: "#131313" }}
        >
          Upgrade to Pro
        </button>
      </div>

      {/* Profile */}
      <div
        className="px-3 pb-4 pt-3 shrink-0"
        style={{ borderTop: "1px solid rgba(68,71,72,0.2)" }}
      >
        <div className="flex items-center gap-3 px-3 py-2">
          <div
            className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: "#353534" }}
          >
            <span style={{ color: "#e5e2e1" }}>{initials}</span>
          </div>
          <span className="truncate" style={{ fontSize: 14, color: "#e5e2e1" }}>
            {user?.full_name ?? "Account"}
          </span>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="ml-auto shrink-0 p-1 rounded transition-colors hover:bg-[#2a2a2a]"
            style={{ color: "#8e9192" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside
      className="hidden lg:flex flex-col h-full shrink-0"
      style={{ width: 280, background: "#1c1b1b", borderRight: "1px solid rgba(68,71,72,0.2)" }}
    >
      <SidebarContent />
    </aside>
  );
}
