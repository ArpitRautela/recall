"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@/stores/authStore";

export default function TopBar({
  user,
  onMenuClick,
}: {
  user: AuthUser;
  onMenuClick?: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [placeholder, setPlaceholder] = useState("Search…");

  // The full prompt only fits on wider screens.
  useEffect(() => {
    const apply = () =>
      setPlaceholder(
        window.innerWidth >= 640
          ? "Search your memories, files, and conversations..."
          : "Search…"
      );
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const initials = user.full_name
    ?.split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "U";

  return (
    <header
      className="flex items-center gap-2 sm:gap-4 px-3 sm:px-6 shrink-0"
      style={{
        height: 64,
        background: "rgba(19,19,19,0.9)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(68,71,72,0.2)",
      }}
    >
      <button
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="lg:hidden shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-[#2a2a2a]"
        style={{ color: "#c4c7c8" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>menu</span>
      </button>

      <form onSubmit={handleSearch} className="flex-1 min-w-0 max-w-lg relative">
        <span
          className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ fontSize: 18, color: "#8e9192" }}
        >
          search
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg outline-none transition-colors bg-[#201f1f] text-[#e5e2e1] placeholder:text-[#8e9192]"
          style={{ border: "1px solid #444748" }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor = "rgba(192,193,255,0.5)")
          }
          onBlur={(e) => (e.currentTarget.style.borderColor = "#444748")}
        />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("recall:open-palette"))}
          title="Quick jump (Ctrl/Cmd + K)"
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors hover:bg-[#3a3a3a]"
          style={{ background: "rgba(68,71,72,0.5)", color: "#8e9192" }}
        >
          ⌘K
        </button>
      </form>

      <div className="flex items-center gap-1 ml-auto">
        <Link
          href="/memories"
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[#2a2a2a]"
          title="Recent activity"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, color: "#c4c7c8" }}
          >
            notifications
          </span>
        </Link>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ml-1 shrink-0 cursor-pointer"
          style={{ background: "rgba(192,193,255,0.2)", color: "#c0c1ff" }}
          title={user.full_name}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
