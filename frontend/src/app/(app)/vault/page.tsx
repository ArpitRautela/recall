"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  documentService,
  type RecallDocument,
  type DocumentStatus,
  type DocumentChunk,
  type StorageUsage,
} from "@/services/documents";
import { healthService, type ReadinessReport } from "@/services/health";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { workspaceService, type Workspace } from "@/services/workspace";
import { formatBytes, formatDate, fileIcon } from "@/lib/format";
import { extractErrorMessage } from "@/lib/errors";

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

const ALLOWED_EXTENSIONS = ".pdf,.docx";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const TYPE_FILTERS = [
  { value: "all", label: "All File Types" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOCX" },
] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number]["value"];

const DATE_FILTERS = [
  { value: "any", label: "Any time", days: null },
  { value: "today", label: "Today", days: 1 },
  { value: "week", label: "Last 7 days", days: 7 },
  { value: "month", label: "Last 30 days", days: 30 },
] as const;
type DateFilter = (typeof DATE_FILTERS)[number]["value"];

const SORT_MODES = [
  { value: "date", label: "Date Added" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
] as const;
type SortMode = (typeof SORT_MODES)[number]["value"];

const STATUS_DISPLAY: Record<DocumentStatus, { label: string; color: string }> = {
  PENDING: { label: "PENDING", color: "#8e9192" },
  PROCESSING: { label: "PROCESSING", color: "#facc15" },
  READY: { label: "INDEXED", color: "#4ade80" },
  FAILED: { label: "ERROR", color: "#f87171" },
};

export default function VaultPage() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [documents, setDocuments] = useState<RecallDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("any");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [health, setHealth] = useState<ReadinessReport | null>(null);
  const [healthUnreachable, setHealthUnreachable] = useState(false);
  const [detailDoc, setDetailDoc] = useState<RecallDocument | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [chunksError, setChunksError] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<RecallDocument | null>(null);
  const [confirmDeleteWs, setConfirmDeleteWs] = useState<Workspace | null>(null);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openDetail = (doc: RecallDocument) => {
    setDetailDoc(doc);
    setChunks(null);
    setChunksError(false);
    documentService
      .getChunks(doc.id)
      .then(setChunks)
      .catch(() => setChunksError(true));
  };

  // Escape closes the detail modal.
  useEffect(() => {
    if (!detailDoc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailDoc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailDoc]);

  const fetchDocuments = useCallback(async (workspaceId: number | null) => {
    try {
      const docs = await documentService.list(workspaceId ?? undefined);
      setDocuments(docs);
    } catch {
      toast.error("Failed to load documents.");
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const ws = await workspaceService.list();
      setWorkspaces(ws);
    } catch {
      toast.error("Failed to load collections.");
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      setUsage(await documentService.usage());
    } catch {
      setUsage(null);
    }
  }, []);

  // Poll readiness so the footer indicator reflects real dependency state.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const report = await healthService.ready();
        if (!cancelled) {
          setHealth(report);
          setHealthUnreachable(false);
        }
      } catch {
        if (!cancelled) setHealthUnreachable(true);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    fetchDocuments(activeWorkspaceId).finally(() => setLoading(false));
  }, [activeWorkspaceId, fetchDocuments]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Poll while anything is still processing, so status badges update live
  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === "PENDING" || d.status === "PROCESSING"
    );
    if (!hasPending) return;
    const interval = setInterval(() => fetchDocuments(activeWorkspaceId), 3000);
    return () => clearInterval(interval);
  }, [documents, activeWorkspaceId, fetchDocuments]);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    await Promise.all(
      Array.from(files).map(async (file) => {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} exceeds the 50MB limit.`);
          return;
        }
        try {
          await documentService.upload(file, { workspaceId: activeWorkspaceId ?? undefined });
          toast.success(`${file.name} uploaded — processing started.`);
        } catch (err) {
          toast.error(extractErrorMessage(err, `Failed to upload ${file.name}.`));
        }
      })
    );

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fetchDocuments(activeWorkspaceId);
    fetchWorkspaces();
    fetchUsage();
  };

  const handleDelete = async (doc: RecallDocument) => {
    setConfirmDeleteDoc(null);
    try {
      await documentService.remove(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      fetchWorkspaces();
      fetchUsage();
      toast.success("Document deleted.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to delete document."));
    }
  };

  const handleReprocess = async (doc: RecallDocument) => {
    try {
      const updated = await documentService.reprocess(doc.id);
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      toast.success(`Reprocessing "${doc.original_filename}"...`);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to reprocess document."));
    }
  };

  const handleCreateWorkspace = async (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    setNewCollectionOpen(false);
    setNewCollectionName("");
    try {
      const ws = await workspaceService.create(name.trim());
      setWorkspaces((prev) => [...prev, ws]);
      setActiveWorkspaceId(ws.id);
      toast.success(`Collection "${ws.name}" created.`);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to create collection."));
    }
  };

  const handleDeleteWorkspace = async (ws: Workspace) => {
    setConfirmDeleteWs(null);
    try {
      await workspaceService.remove(ws.id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== ws.id));
      if (activeWorkspaceId === ws.id) setActiveWorkspaceId(null);
      toast.success("Collection deleted.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to delete collection."));
    }
  };

  const totalDocuments = documents.length;
  const storageUsedBytes = documents.reduce((sum, d) => sum + d.file_size, 0);
  const indexedCount = documents.filter((d) => d.status === "READY").length;
  const indexedPct = totalDocuments > 0 ? Math.round((indexedCount / totalDocuments) * 100) : 0;
  const recentCount = documents.filter(
    (d) => Date.now() - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000
  ).length;
  const allDocumentsCount = workspaces.reduce((sum, w) => sum + w.document_count, 0);

  // Account-wide, from the server — `storageUsedBytes` below only covers the
  // currently filtered workspace, so it would disagree with the quota.
  const usedBytes = usage?.used_bytes ?? storageUsedBytes;

  // Stats above describe the whole collection; filters only narrow the listing below.
  const visibleDocuments = useMemo(() => {
    let list = documents;

    if (typeFilter !== "all") {
      list = list.filter((d) =>
        typeFilter === "pdf"
          ? d.mime_type === "application/pdf"
          : d.mime_type.includes("wordprocessingml")
      );
    }

    const days = DATE_FILTERS.find((f) => f.value === dateFilter)?.days ?? null;
    if (days !== null) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      list = list.filter((d) => new Date(d.created_at).getTime() >= cutoff);
    }

    return [...list].sort((a, b) => {
      if (sortMode === "name") return a.original_filename.localeCompare(b.original_filename);
      if (sortMode === "size") return b.file_size - a.file_size;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [documents, typeFilter, dateFilter, sortMode]);

  const healthLabel = (() => {
    if (healthUnreachable) {
      return { text: "API Unreachable", color: "#f87171", detail: "Could not reach the backend." };
    }
    if (!health) {
      return { text: "Checking…", color: "#8e9192", detail: "Checking system status." };
    }
    const down = Object.entries(health.dependencies)
      .filter(([, d]) => d.status === "down")
      .map(([name]) => name);
    if (down.length === 0) {
      return { text: "Systems Online", color: "#4ade80", detail: "All dependencies reachable." };
    }
    return {
      text: `Degraded — ${down.join(", ")}`,
      color: "#facc15",
      detail: `Unavailable: ${down.join(", ")}`,
    };
  })();

  const STATS = [
    { label: "Total Documents", value: String(totalDocuments), sub: "", icon: "description" },
    {
      label: "Storage Used",
      value: formatBytes(usedBytes),
      sub: usage ? `of ${formatBytes(usage.quota_bytes)}` : "",
      icon: "donut_large",
    },
    { label: "Indexed Items", value: String(indexedCount), sub: `${indexedPct}%`, icon: "check_circle" },
    { label: "Recently Added", value: String(recentCount), sub: "last 24h", icon: "history" },
  ];

  return (
    <div className="relative h-full overflow-y-auto" style={{ background: "#131313" }}>
      <div
        className="fixed bottom-0 right-0 w-1/2 h-1/2 rounded-full pointer-events-none -z-10"
        style={{ background: "rgba(192,193,255,0.05)", filter: "blur(120px)", transform: "translate(33%,33%)" }}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS}
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />

      {/* Header */}
      <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="font-semibold text-[#ffffff]" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
              Vault
            </h1>
            <p style={{ fontSize: 14, color: "#c4c7c8", marginTop: 2 }}>
              Manage every document in your knowledge base.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "#ffffff", color: "#131313" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                {uploading ? "hourglass_top" : "upload_file"}
              </span>
              {uploading ? "Uploading..." : "Upload Files"}
            </button>
          </div>
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
            <p className="font-semibold text-[#e5e2e1]" style={{ fontSize: 24, letterSpacing: "-0.03em" }}>
              {s.value}
            </p>
            <p className="text-xs mt-1" style={{ color: "#8e9192" }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Body: collections + file grid */}
      <div className="px-4 sm:px-8 flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* Collections sidebar */}
        <aside className="w-full lg:w-48 shrink-0">
          <p className="text-xs font-semibold uppercase mb-3" style={{ color: "#8e9192", letterSpacing: "0.1em" }}>
            Collections
          </p>
          <div className="space-y-0.5">
            <div
              onClick={() => setActiveWorkspaceId(null)}
              className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
              style={{
                background: activeWorkspaceId === null ? "rgba(255,255,255,0.06)" : "transparent",
                color: activeWorkspaceId === null ? "#e5e2e1" : "#c4c7c8",
                borderLeft: activeWorkspaceId === null ? "2px solid #e5e2e1" : "2px solid transparent",
              }}
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>grid_view</span>
                All Documents
              </span>
              <span className="text-xs" style={{ color: "#8e9192" }}>{allDocumentsCount}</span>
            </div>
            {workspaces.map((w) => {
              const active = w.id === activeWorkspaceId;
              return (
                <div
                  key={w.id}
                  onClick={() => setActiveWorkspaceId(w.id)}
                  className="group flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer"
                  style={{
                    background: active ? "rgba(255,255,255,0.06)" : "transparent",
                    color: active ? "#e5e2e1" : "#c4c7c8",
                    borderLeft: active ? "2px solid #e5e2e1" : "2px solid transparent",
                  }}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18 }}>
                      {w.is_default ? "folder" : "folder_open"}
                    </span>
                    <span className="truncate">{w.name}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-xs" style={{ color: "#8e9192" }}>{w.document_count}</span>
                    {!w.is_default && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteWs(w); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: "#8e9192" }}>
                          delete
                        </span>
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => setNewCollectionOpen(true)}
            className="flex items-center gap-1 px-3 py-2 text-sm mt-2 transition-colors hover:text-[#e5e2e1]"
            style={{ color: "#c4c7c8" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            New Collection
          </button>
        </aside>

        {/* File area */}
        <div className="flex-1 min-w-0">
          {/* Filter bar */}
          <div
            className="flex flex-wrap items-center gap-2 mb-4 px-3 sm:px-4 py-2 rounded-xl"
            style={CARD_STYLE}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8e9192" }}>filter_list</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="px-3 py-1 rounded text-xs font-medium outline-none"
              style={{ border: "1px solid rgba(68,71,72,0.3)", color: "#c4c7c8", background: "#201f1f" }}
            >
              {TYPE_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="px-3 py-1 rounded text-xs font-medium outline-none"
              style={{ border: "1px solid rgba(68,71,72,0.3)", color: "#c4c7c8", background: "#201f1f" }}
            >
              {DATE_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {(typeFilter !== "all" || dateFilter !== "any") && (
              <button
                onClick={() => { setTypeFilter("all"); setDateFilter("any"); }}
                className="px-2 py-1 rounded text-xs transition-colors hover:text-[#e5e2e1]"
                style={{ color: "#8e9192" }}
              >
                Clear
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1 text-xs" style={{ color: "#c4c7c8" }}>
                <span>Sort by:</span>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="font-semibold outline-none px-1 py-0.5 rounded"
                  style={{ color: "#e5e2e1", background: "#201f1f", border: "1px solid rgba(68,71,72,0.3)" }}
                >
                  {SORT_MODES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex">
                {["grid_view", "view_list"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v === "grid_view" ? "grid" : "list")}
                    className="p-1 rounded transition-colors"
                    style={{
                      background: (v === "grid_view") === (viewMode === "grid") ? "rgba(255,255,255,0.06)" : "transparent",
                      color: (v === "grid_view") === (viewMode === "grid") ? "#e5e2e1" : "#8e9192",
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{v}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Files */}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div
                className="w-8 h-8 rounded-full border-2 animate-spin"
                style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
              />
            </div>
          ) : documents.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-24 rounded-xl text-center cursor-pointer transition-all hover:border-white/20"
              style={{ ...CARD_STYLE, border: "2px dashed rgba(68,71,72,0.2)" }}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="material-symbols-outlined mb-3" style={{ fontSize: 32, color: "#8e9192" }}>
                cloud_upload
              </span>
              <p className="font-medium" style={{ fontSize: 14, color: "#e5e2e1" }}>
                No documents yet
              </p>
              <p className="mt-1" style={{ fontSize: 12, color: "#8e9192" }}>
                Click here or use "Upload Files" to add your first document
              </p>
            </div>
          ) : visibleDocuments.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-24 rounded-xl text-center"
              style={{ ...CARD_STYLE, border: "2px dashed rgba(68,71,72,0.2)" }}
            >
              <span className="material-symbols-outlined mb-3" style={{ fontSize: 32, color: "#8e9192" }}>
                filter_alt_off
              </span>
              <p className="font-medium" style={{ fontSize: 14, color: "#e5e2e1" }}>
                No documents match these filters
              </p>
              <button
                onClick={() => { setTypeFilter("all"); setDateFilter("any"); }}
                className="mt-2 text-xs transition-colors hover:text-[#e5e2e1]"
                style={{ color: "#c0c1ff" }}
              >
                Clear filters
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleDocuments.map((d) => {
                const { icon, iconBg, iconColor } = fileIcon(d.mime_type);
                const status = STATUS_DISPLAY[d.status];
                return (
                  <div
                    key={d.id}
                    onClick={() => openDetail(d)}
                    className="p-4 rounded-xl cursor-pointer group transition-all hover:border-white/20"
                    style={CARD_STYLE}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div
                        className="w-10 h-10 rounded flex items-center justify-center"
                        style={{ background: iconBg }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 22, color: iconColor }}>
                          {icon}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        {(d.status === "FAILED" || d.status === "READY") && (
                          <button onClick={(e) => { e.stopPropagation(); handleReprocess(d); }} title="Reprocess document">
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8e9192" }}>
                              refresh
                            </span>
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteDoc(d); }} title="Delete document">
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8e9192" }}>
                            delete
                          </span>
                        </button>
                      </div>
                    </div>
                    <p className="font-medium text-[#e5e2e1] truncate text-sm mb-1" title={d.original_filename}>
                      {d.original_filename}
                    </p>
                    <p className="text-xs" style={{ color: "#8e9192" }}>
                      {formatBytes(d.file_size)}
                      <span className="mx-1">•</span>
                      {formatDate(d.created_at)}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-semibold"
                        style={{ background: `${status.color}20`, color: status.color, letterSpacing: "0.05em" }}
                      >
                        {status.label}
                      </span>
                      {d.status === "FAILED" && d.error_message && (
                        <span className="text-xs truncate" style={{ color: "#8e9192" }} title={d.error_message}>
                          {d.error_message}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={CARD_STYLE}>
              {visibleDocuments.map((d, i) => {
                const { icon, iconBg, iconColor } = fileIcon(d.mime_type);
                const status = STATUS_DISPLAY[d.status];
                return (
                  <div
                    key={d.id}
                    onClick={() => openDetail(d)}
                    className="flex items-center gap-4 px-5 py-3 transition-all hover:bg-[#2a2a2a] cursor-pointer group"
                    style={{ borderBottom: i < visibleDocuments.length - 1 ? "1px solid rgba(68,71,72,0.1)" : "none" }}
                  >
                    <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: iconBg }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: iconColor }}>{icon}</span>
                    </div>
                    <span className="flex-1 text-sm text-[#e5e2e1] truncate">{d.original_filename}</span>
                    <span className="text-xs" style={{ color: "#8e9192" }}>{formatBytes(d.file_size)}</span>
                    <span className="text-xs" style={{ color: "#8e9192" }}>{formatDate(d.created_at)}</span>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-semibold"
                      style={{ background: `${status.color}20`, color: status.color }}
                    >
                      {status.label}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      {(d.status === "FAILED" || d.status === "READY") && (
                        <button onClick={(e) => { e.stopPropagation(); handleReprocess(d); }} title="Reprocess document">
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8e9192" }}>
                            refresh
                          </span>
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteDoc(d); }} title="Delete document">
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#8e9192" }}>delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="px-4 sm:px-8 py-3 mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs sticky bottom-0"
        style={{ background: "#131313", borderTop: "1px solid rgba(68,71,72,0.1)", color: "#8e9192" }}
      >
        <span className="flex items-center gap-2" title={healthLabel.detail}>
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ background: healthLabel.color }}
          />
          {healthLabel.text}
        </span>
        <span>
          {totalDocuments} Documents • {formatBytes(usedBytes)} Used
          {usage ? ` of ${formatBytes(usage.quota_bytes)}` : ""}
        </span>
      </div>


      {/* Delete document */}
      <Dialog open={!!confirmDeleteDoc} onOpenChange={(o) => !o && setConfirmDeleteDoc(null)}>
        <DialogContent style={{ background: "#1c1b1b", border: "1px solid rgba(68,71,72,0.4)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "#e5e2e1" }}>Delete document</DialogTitle>
            <DialogDescription style={{ color: "#c4c7c8" }}>
              &ldquo;{confirmDeleteDoc?.original_filename}&rdquo; and everything indexed from it
              will be removed. This can&rsquo;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmDeleteDoc(null)}
              className="px-4 py-2 rounded text-sm transition-colors hover:bg-[#2a2a2a]"
              style={{ border: "1px solid rgba(68,71,72,0.4)", color: "#c4c7c8" }}
            >
              Cancel
            </button>
            <button
              onClick={() => confirmDeleteDoc && handleDelete(confirmDeleteDoc)}
              className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: "#f87171", color: "#131313" }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete collection */}
      <Dialog open={!!confirmDeleteWs} onOpenChange={(o) => !o && setConfirmDeleteWs(null)}>
        <DialogContent style={{ background: "#1c1b1b", border: "1px solid rgba(68,71,72,0.4)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "#e5e2e1" }}>Delete collection</DialogTitle>
            <DialogDescription style={{ color: "#c4c7c8" }}>
              &ldquo;{confirmDeleteWs?.name}&rdquo; will be removed. Documents inside it are not
              deleted, but a collection must be empty first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmDeleteWs(null)}
              className="px-4 py-2 rounded text-sm transition-colors hover:bg-[#2a2a2a]"
              style={{ border: "1px solid rgba(68,71,72,0.4)", color: "#c4c7c8" }}
            >
              Cancel
            </button>
            <button
              onClick={() => confirmDeleteWs && handleDeleteWorkspace(confirmDeleteWs)}
              className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: "#f87171", color: "#131313" }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New collection */}
      <Dialog open={newCollectionOpen} onOpenChange={setNewCollectionOpen}>
        <DialogContent style={{ background: "#1c1b1b", border: "1px solid rgba(68,71,72,0.4)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "#e5e2e1" }}>New collection</DialogTitle>
            <DialogDescription style={{ color: "#c4c7c8" }}>
              Collections group documents. Uploads go to the collection you have selected.
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace(newCollectionName)}
            placeholder="e.g. Research papers"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "#131313", border: "1px solid rgba(68,71,72,0.3)", color: "#e5e2e1" }}
          />
          <DialogFooter>
            <button
              onClick={() => setNewCollectionOpen(false)}
              className="px-4 py-2 rounded text-sm transition-colors hover:bg-[#2a2a2a]"
              style={{ border: "1px solid rgba(68,71,72,0.4)", color: "#c4c7c8" }}
            >
              Cancel
            </button>
            <button
              onClick={() => handleCreateWorkspace(newCollectionName)}
              disabled={!newCollectionName.trim()}
              className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "#ffffff", color: "#131313" }}
            >
              Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document detail */}
      {detailDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setDetailDoc(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[90vh] sm:max-h-[85vh] rounded-xl flex flex-col overflow-hidden"
            style={{ background: "#1c1b1b", border: "1px solid rgba(68,71,72,0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-4 sm:px-6 py-4 flex items-start justify-between shrink-0"
              style={{ borderBottom: "1px solid rgba(68,71,72,0.2)" }}
            >
              <div className="min-w-0">
                <h2 className="font-semibold text-[#e5e2e1] truncate" style={{ fontSize: 16 }}>
                  {detailDoc.original_filename}
                </h2>
                <p className="text-xs mt-1" style={{ color: "#8e9192" }}>
                  {formatBytes(detailDoc.file_size)} • {formatDate(detailDoc.created_at)} •{" "}
                  <span style={{ color: STATUS_DISPLAY[detailDoc.status].color }}>
                    {STATUS_DISPLAY[detailDoc.status].label}
                  </span>
                  {detailDoc.status === "READY" ? ` • ${detailDoc.chunk_count} chunks` : ""}
                </p>
              </div>
              <button
                onClick={() => setDetailDoc(null)}
                className="shrink-0 ml-4 p-1 rounded transition-colors hover:bg-[#2a2a2a]"
                style={{ color: "#8e9192" }}
                title="Close"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
              {detailDoc.status === "FAILED" ? (
                <div
                  className="p-4 rounded-xl"
                  style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}
                >
                  <p className="text-sm font-medium" style={{ color: "#f87171" }}>Processing failed</p>
                  <p className="text-xs mt-1" style={{ color: "#c4c7c8", lineHeight: "18px" }}>
                    {detailDoc.error_message ?? "No reason recorded."}
                  </p>
                </div>
              ) : detailDoc.status !== "READY" ? (
                <p className="text-sm" style={{ color: "#8e9192" }}>
                  This document is still being processed. Chunks appear once it's indexed.
                </p>
              ) : chunksError ? (
                <p className="text-sm" style={{ color: "#f87171" }}>Couldn&apos;t load chunks.</p>
              ) : chunks === null ? (
                <div className="flex items-center justify-center py-12">
                  <div
                    className="w-6 h-6 rounded-full border-2 animate-spin"
                    style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
                  />
                </div>
              ) : chunks.length === 0 ? (
                <p className="text-sm" style={{ color: "#8e9192" }}>No chunks were extracted.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs" style={{ color: "#8e9192" }}>
                    The searchable passages extracted from this document.
                  </p>
                  {chunks.map((c) => (
                    <div key={c.chunk_index} className="p-3 rounded-xl" style={CARD_STYLE}>
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                          style={{ background: "rgba(192,193,255,0.15)", color: "#c0c1ff" }}
                        >
                          #{c.chunk_index}
                        </span>
                        {c.page_number !== null && (
                          <span className="text-xs" style={{ color: "#8e9192" }}>p. {c.page_number}</span>
                        )}
                        <span className="text-xs ml-auto" style={{ color: "#8e9192" }}>
                          {c.token_count} tokens
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: "#c4c7c8", lineHeight: "18px" }}>
                        {c.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
