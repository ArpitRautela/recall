"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { formatRelativeTime } from "@/lib/format";
import {
  memoryService,
  type FrequentItem,
  type RecentItem,
  type TimelineEvent,
} from "@/services/memory";
import { workspaceService, type Workspace } from "@/services/workspace";

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

const FILTERS = ["All", "Documents", "Conversations"] as const;
type Filter = (typeof FILTERS)[number];

const EVENT_ICON: Record<TimelineEvent["event_type"], string> = {
  DOCUMENT_UPLOADED: "upload_file",
  DOCUMENT_READY: "description",
  DOCUMENT_FAILED: "error",
  CONVERSATION_STARTED: "forum",
};

const STATUS_COLOR: Record<string, string> = {
  READY: "#4ade80",
  PROCESSING: "#c0c1ff",
  PENDING: "#8e9192",
  FAILED: "#f87171",
};

function itemHref(kind: RecentItem["kind"], id: number): string {
  // Vault has no per-document route yet, so documents link to the list rather than a dead deep link.
  return kind === "document" ? "/vault" : `/chat/${id}`;
}

function bucketLabel(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (dt: Date) =>
    new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This Week";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This Week", "Older"];

export default function MemoriesPage() {
  const [activeFilter, setActiveFilter] = useState<Filter>("All");
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [frequent, setFrequent] = useState<FrequentItem[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      memoryService.recent(8),
      memoryService.timeline(50),
      memoryService.frequent(5),
      workspaceService.list(),
    ])
      .then(([recentItems, events, frequentItems, spaces]) => {
        setRecent(recentItems);
        setTimeline(events);
        setFrequent(frequentItems);
        setWorkspaces(spaces);
      })
      .catch(() => toast.error("Failed to load memories."))
      .finally(() => setLoading(false));
  }, []);

  const filteredRecent = useMemo(() => {
    if (activeFilter === "Documents") return recent.filter((r) => r.kind === "document");
    if (activeFilter === "Conversations") return recent.filter((r) => r.kind === "conversation");
    return recent;
  }, [recent, activeFilter]);

  const groupedTimeline = useMemo(() => {
    const groups = new Map<string, TimelineEvent[]>();
    for (const event of timeline) {
      const label = bucketLabel(event.created_at);
      const existing = groups.get(label);
      if (existing) existing.push(event);
      else groups.set(label, [event]);
    }
    return BUCKET_ORDER.filter((label) => groups.has(label)).map((label) => ({
      label,
      entries: groups.get(label)!,
    }));
  }, [timeline]);

  const totalDocuments = useMemo(
    () => workspaces.reduce((sum, w) => sum + w.document_count, 0),
    [workspaces]
  );

  return (
    <div className="relative h-full overflow-y-auto" style={{ background: "#131313" }}>
      <div
        className="fixed bottom-0 right-0 w-1/2 h-1/2 rounded-full pointer-events-none -z-10"
        style={{
          background: "rgba(192,193,255,0.05)",
          filter: "blur(120px)",
          transform: "translate(33%,33%)",
        }}
      />

      <div className="flex h-full">
        {/* Main */}
        <div className="flex-1 min-w-0 overflow-y-auto px-8 pt-8 pb-8">
          <div className="mb-6">
            <h1
              className="font-semibold text-[#ffffff]"
              style={{ fontSize: 32, letterSpacing: "-0.03em" }}
            >
              Memories
            </h1>
            <p style={{ fontSize: 14, color: "#c4c7c8", marginTop: 4 }}>
              Everything RECALL has captured from your documents and conversations
            </p>
          </div>

          {/* Summary */}
          <div className="p-6 rounded-xl mb-6 relative overflow-hidden" style={CARD_STYLE}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16, color: "#c0c1ff" }}
                  >
                    insights
                  </span>
                  <span
                    className="text-xs font-semibold uppercase"
                    style={{ color: "#c0c1ff", letterSpacing: "0.1em" }}
                  >
                    Knowledge Base
                  </span>
                </div>
                <p style={{ fontSize: 16, color: "#e5e2e1", lineHeight: "24px" }}>
                  {loading
                    ? "Loading your knowledge base…"
                    : totalDocuments === 0
                      ? "Nothing captured yet — upload a document or start a conversation to begin building your knowledge base."
                      : `You have ${totalDocuments} document${totalDocuments === 1 ? "" : "s"} across ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}.`}
                </p>
                <div className="flex gap-2 mt-4">
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{ background: "rgba(68,71,72,0.4)", color: "#e5e2e1" }}
                  >
                    {totalDocuments} Documents
                  </span>
                  <span
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{ background: "rgba(68,71,72,0.4)", color: "#e5e2e1" }}
                  >
                    {timeline.length} Recent Events
                  </span>
                </div>
              </div>
              <span
                className="material-symbols-outlined shrink-0 ml-4"
                style={{ fontSize: 40, color: "rgba(192,193,255,0.3)" }}
              >
                auto_awesome
              </span>
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex items-center gap-2 flex-wrap mb-6">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{
                  background: activeFilter === f ? "#ffffff" : "rgba(68,71,72,0.2)",
                  color: activeFilter === f ? "#131313" : "#c4c7c8",
                  border: "1px solid rgba(68,71,72,0.2)",
                }}
              >
                {f === "All" && (
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                    filter_list
                  </span>
                )}
                {f}
              </button>
            ))}
          </div>

          {/* Recent items grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
            {loading ? (
              <p className="text-sm" style={{ color: "#8e9192" }}>
                Loading…
              </p>
            ) : filteredRecent.length === 0 ? (
              <p className="text-sm" style={{ color: "#8e9192" }}>
                Nothing here yet.
              </p>
            ) : (
              filteredRecent.map((m) => (
                <Link
                  key={`${m.kind}-${m.id}`}
                  href={itemHref(m.kind, m.id)}
                  className="p-5 rounded-xl cursor-pointer transition-all hover:border-white/20 block"
                  style={CARD_STYLE}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3
                      className="font-medium text-[#e5e2e1]"
                      style={{ fontSize: 16, lineHeight: "24px", flex: 1, marginRight: 12 }}
                    >
                      {m.title}
                    </h3>
                    {m.status && (
                      <span
                        className="px-2 py-1 rounded text-xs font-bold shrink-0"
                        style={{
                          background: "rgba(192,193,255,0.15)",
                          color: STATUS_COLOR[m.status] ?? "#c0c1ff",
                        }}
                      >
                        {m.status}
                      </span>
                    )}
                  </div>
                  <p className="text-sm line-clamp-2 mb-4" style={{ color: "#c4c7c8", lineHeight: "20px" }}>
                    {m.kind === "document"
                      ? m.chunk_count
                        ? `Indexed into ${m.chunk_count} searchable chunks.`
                        : "Not yet indexed."
                      : "Conversation grounded in your documents."}
                  </p>
                  <div className="flex items-center justify-between">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16, color: "#8e9192" }}
                    >
                      {m.kind === "document" ? "description" : "forum"}
                    </span>
                    <span className="text-xs" style={{ color: "#8e9192" }}>
                      {formatRelativeTime(m.updated_at)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>

          {/* History Timeline */}
          <div>
            <h2
              className="font-semibold text-[#ffffff] mb-5"
              style={{ fontSize: 20, letterSpacing: "-0.02em" }}
            >
              History Timeline
            </h2>
            {!loading && groupedTimeline.length === 0 ? (
              <p className="text-sm" style={{ color: "#8e9192" }}>
                No activity recorded yet.
              </p>
            ) : (
              <div className="space-y-6">
                {groupedTimeline.map((group) => (
                  <div key={group.label}>
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: "#c0c1ff" }}
                      />
                      <p
                        className="text-xs font-semibold uppercase"
                        style={{ color: "#8e9192", letterSpacing: "0.1em" }}
                      >
                        {group.label}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {group.entries.map((e) => (
                        <div key={e.id} className="ml-5 p-4 rounded-xl flex gap-3" style={CARD_STYLE}>
                          <span
                            className="material-symbols-outlined shrink-0 mt-0.5"
                            style={{
                              fontSize: 18,
                              color:
                                e.event_type === "DOCUMENT_FAILED" ? "#f87171" : "#c4c7c8",
                            }}
                          >
                            {EVENT_ICON[e.event_type]}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#e5e2e1]">{e.title}</p>
                            {e.subtitle && (
                              <p className="text-xs mt-0.5" style={{ color: "#8e9192" }}>
                                {e.subtitle}
                              </p>
                            )}
                            <p className="text-xs mt-0.5" style={{ color: "#8e9192" }}>
                              {formatRelativeTime(e.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <aside
          className="w-64 shrink-0 overflow-y-auto p-6 flex flex-col gap-6"
          style={{ borderLeft: "1px solid rgba(68,71,72,0.1)" }}
        >
          {/* Workspaces */}
          <div>
            <p
              className="text-xs font-semibold uppercase mb-3"
              style={{ color: "#8e9192", letterSpacing: "0.1em" }}
            >
              Workspaces
            </p>
            <div className="space-y-0.5">
              {workspaces.length === 0 ? (
                <p className="text-xs" style={{ color: "#8e9192" }}>
                  None yet.
                </p>
              ) : (
                workspaces.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg transition-all hover:bg-[#2a2a2a]"
                  >
                    <span className="flex items-center gap-2 text-sm text-[#e5e2e1] min-w-0">
                      <span
                        className="material-symbols-outlined shrink-0"
                        style={{ fontSize: 16, color: "#c4c7c8" }}
                      >
                        {w.is_default ? "home_storage" : "folder"}
                      </span>
                      <span className="truncate">{w.name}</span>
                    </span>
                    <span className="text-xs shrink-0 ml-2" style={{ color: "#8e9192" }}>
                      {w.document_count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Frequent Access */}
          <div>
            <p
              className="text-xs font-semibold uppercase mb-3"
              style={{ color: "#8e9192", letterSpacing: "0.1em" }}
            >
              Frequent Access
            </p>
            <div className="space-y-3">
              {frequent.length === 0 ? (
                <p className="text-xs" style={{ color: "#8e9192" }}>
                  Nothing accessed this week.
                </p>
              ) : (
                frequent.map((f) => (
                  <Link key={`${f.kind}-${f.id}`} href={itemHref(f.kind, f.id)} className="block">
                    <p className="text-sm text-[#e5e2e1] hover:text-[#c0c1ff] transition-colors truncate">
                      {f.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#8e9192" }}>
                      Accessed {f.access_count} time{f.access_count === 1 ? "" : "s"} this week
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
