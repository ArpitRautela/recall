"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { chatService, type ConversationSummary } from "@/services/chat";

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

type SortMode = "recent" | "alpha";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function bucketLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This Week";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This Week", "Older"];

export default function ConversationsPage() {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chatService
      .listConversations()
      .then(setConversations)
      .catch(() => toast.error("Failed to load conversations."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = conversations;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          (c.title ?? "").toLowerCase().includes(q) ||
          (c.preview ?? "").toLowerCase().includes(q)
      );
    }
    list = [...list];
    if (sortMode === "alpha") {
      list.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    } else {
      list.sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime());
    }
    return list;
  }, [conversations, search, sortMode]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ConversationSummary[]>();
    for (const c of filtered) {
      const key = sortMode === "alpha" ? "All Conversations" : bucketLabel(c.updated_at ?? new Date().toISOString());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    if (sortMode === "alpha") return groups;
    const ordered = new Map<string, ConversationSummary[]>();
    for (const key of BUCKET_ORDER) {
      if (groups.has(key)) ordered.set(key, groups.get(key)!);
    }
    return ordered;
  }, [filtered, sortMode]);

  const totalConversations = conversations.length;
  const activeThisWeek = conversations.filter(
    (c) => Date.now() - new Date(c.updated_at ?? 0).getTime() < 7 * 24 * 60 * 60 * 1000
  ).length;
  const totalMessages = conversations.reduce((sum, c) => sum + c.message_count, 0);
  const longestChat = conversations.reduce((max, c) => Math.max(max, c.message_count), 0);

  const STATS = [
    { label: "Total Conversations", value: String(totalConversations), icon: "forum" },
    { label: "Active This Week", value: String(activeThisWeek), icon: "bolt" },
    { label: "Total Messages", value: String(totalMessages), icon: "chat_bubble" },
    { label: "Longest Chat", value: `${longestChat} msgs`, icon: "trending_up" },
  ];

  return (
    <div className="relative h-full overflow-y-auto" style={{ background: "#131313" }}>
      {/* Atmospheric glow */}
      <div
        className="fixed bottom-0 right-0 w-1/2 h-1/2 rounded-full pointer-events-none -z-10"
        style={{ background: "rgba(192,193,255,0.05)", filter: "blur(120px)", transform: "translate(33%,33%)" }}
      />

      {/* Header */}
      <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-semibold text-[#ffffff]" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
              Conversations
            </h1>
            <p style={{ fontSize: 14, color: "#c4c7c8", marginTop: 2 }}>Continue where you left off.</p>
          </div>
          <Link
            href="/chat/new"
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90"
            style={{ background: "#c0c1ff", color: "#07006c" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
              add
            </span>
            New Chat
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 sm:px-8 mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {STATS.map((s) => (
          <div key={s.label} className="p-4 rounded-xl" style={CARD_STYLE}>
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-semibold uppercase" style={{ color: "#8e9192", letterSpacing: "0.08em" }}>
                {s.label}
              </p>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8e9192" }}>
                {s.icon}
              </span>
            </div>
            <p className="font-semibold text-[#e5e2e1]" style={{ fontSize: 28, letterSpacing: "-0.03em" }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="px-4 sm:px-8">
        {/* Search + sort */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <span
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
              style={{ fontSize: 20, color: "#8e9192" }}
            >
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full rounded-lg pl-10 pr-4 py-2.5 text-sm outline-none"
              style={{ background: "#201f1f", border: "1px solid rgba(68,71,72,0.2)", color: "#e5e2e1" }}
            />
          </div>
          <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: "#c4c7c8" }}>
            <span>Sort by:</span>
            <button
              onClick={() => setSortMode(sortMode === "recent" ? "alpha" : "recent")}
              className="flex items-center gap-1 font-semibold text-[#e5e2e1] px-2 py-1 rounded hover:bg-[#2a2a2a] transition-colors"
            >
              {sortMode === "recent" ? "Recently Updated" : "Title A–Z"}
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>swap_vert</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
            />
          </div>
        ) : conversations.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-24 rounded-xl text-center"
            style={CARD_STYLE}
          >
            <span className="material-symbols-outlined mb-3" style={{ fontSize: 32, color: "#8e9192" }}>
              forum
            </span>
            <p className="font-medium" style={{ fontSize: 14, color: "#e5e2e1" }}>
              No conversations yet
            </p>
            <p className="mt-1 mb-4" style={{ fontSize: 12, color: "#8e9192" }}>
              Start a chat to see it show up here.
            </p>
            <Link
              href="/chat/new"
              className="px-4 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: "#c0c1ff", color: "#07006c" }}
            >
              Start New Chat
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center" style={{ color: "#8e9192", fontSize: 14 }}>
            No conversations match "{search}".
          </div>
        ) : (
          Array.from(grouped.entries()).map(([bucket, convs]) => (
            <section key={bucket} className="mb-8">
              <h2
                className="text-xs font-semibold uppercase mb-4"
                style={{ color: "#8e9192", letterSpacing: "0.1em" }}
              >
                {bucket}
              </h2>
              <div className="rounded-xl overflow-hidden" style={CARD_STYLE}>
                {convs.map((c, i) => (
                  <Link
                    key={c.id}
                    href={`/chat/${c.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-all hover:bg-[#2a2a2a] block"
                    style={{ borderBottom: i < convs.length - 1 ? "1px solid rgba(68,71,72,0.1)" : "none" }}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "rgba(192,193,255,0.15)" }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#c0c1ff" }}>
                        forum
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[#e5e2e1] truncate" style={{ fontSize: 15 }}>
                        {c.title || "Untitled conversation"}
                      </p>
                      {c.preview && (
                        <p className="text-sm truncate mt-0.5" style={{ color: "#c4c7c8" }}>
                          {c.preview}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      <span className="text-xs" style={{ color: "#8e9192" }}>
                        {c.message_count} {c.message_count === 1 ? "msg" : "msgs"}
                      </span>
                      <span className="text-xs" style={{ color: "#8e9192" }}>
                        {c.updated_at ? formatTime(c.updated_at) : ""}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 sm:px-8 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs sticky bottom-0"
        style={{ background: "#131313", borderTop: "1px solid rgba(68,71,72,0.1)", color: "#8e9192" }}
      >
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          System Online
        </span>
        <span>{totalConversations} conversations • {totalMessages} messages</span>
      </div>
    </div>
  );
}
