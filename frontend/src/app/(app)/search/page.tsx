"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { searchService, type SearchResult } from "@/services/search";
import { workspaceService, type Workspace } from "@/services/workspace";
import { fileIcon } from "@/lib/format";
import { extractErrorMessage } from "@/lib/errors";

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

const MIME_OPTIONS = [
  { value: "", label: "All File Types" },
  { value: "application/pdf", label: "PDF" },
  { value: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX" },
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [mimeType, setMimeType] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  useEffect(() => {
    workspaceService.list().then(setWorkspaces).catch(() => {});
  }, []);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await searchService.search(trimmed, {
        workspaceId: workspaceId ? Number(workspaceId) : undefined,
        mimeType: mimeType || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setResults(res.results);
      setSubmittedQuery(trimmed);
      setRecentSearches((prev) => [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 8));
    } catch (err) {
      toast.error(extractErrorMessage(err, "Search failed. Try again."));
    } finally {
      setLoading(false);
    }
  };

  const hasActiveFilters = Boolean(workspaceId || mimeType || dateFrom || dateTo);

  return (
    <div className="relative h-full overflow-y-auto" style={{ background: "#131313" }}>
      <div
        className="fixed bottom-0 right-0 w-1/2 h-1/2 rounded-full pointer-events-none -z-10"
        style={{ background: "rgba(192,193,255,0.05)", filter: "blur(120px)", transform: "translate(33%,33%)" }}
      />

      {!searched ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center h-full px-4 pb-24 text-center">
          <h1 className="font-semibold text-[#ffffff] mb-2" style={{ fontSize: "clamp(32px, 9vw, 48px)", letterSpacing: "-0.04em" }}>
            AI Search
          </h1>
          <p className="mb-8" style={{ color: "#c4c7c8", fontSize: 16 }}>
            Find anything across your knowledge base — hybrid semantic + keyword retrieval.
          </p>
          <div
            className="flex items-center gap-3 w-full max-w-xl rounded-xl px-4 py-3"
            style={{ background: "#201f1f", border: "1px solid rgba(68,71,72,0.2)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#c0c1ff" }}>
              auto_awesome
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything about your documents..."
              className="flex-1 bg-transparent outline-none text-sm text-[#e5e2e1]"
              onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
              autoFocus
            />
            <button
              onClick={() => runSearch(query)}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
              style={{ background: "#e5e2e1" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#131313" }}>
                arrow_forward
              </span>
            </button>
          </div>
        </div>
      ) : (
        /* Results state */
        <div className="flex flex-col lg:flex-row h-full">
          {/* Main content */}
          <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-8 py-6 sm:py-8">
            {/* Search bar */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3 mb-4"
              style={{ background: "#201f1f", border: "1px solid rgba(68,71,72,0.2)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#c0c1ff" }}>
                auto_awesome
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "#e5e2e1" }}
              />
              <button
                onClick={() => runSearch(query)}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
                style={{ background: "#e5e2e1" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#131313" }}>
                  arrow_forward
                </span>
              </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <select
                value={mimeType}
                onChange={(e) => setMimeType(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs font-medium outline-none"
                style={{ background: "rgba(68,71,72,0.2)", color: "#c4c7c8", border: "none" }}
              >
                {MIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs font-medium outline-none"
                style={{ background: "rgba(68,71,72,0.2)", color: "#c4c7c8", border: "none" }}
              >
                <option value="">All Collections</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                title="From date"
                className="px-3 py-1.5 rounded-full text-xs font-medium outline-none"
                style={{ background: "rgba(68,71,72,0.2)", color: "#c4c7c8", border: "none", colorScheme: "dark" }}
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                title="To date"
                className="px-3 py-1.5 rounded-full text-xs font-medium outline-none"
                style={{ background: "rgba(68,71,72,0.2)", color: "#c4c7c8", border: "none", colorScheme: "dark" }}
              />
              {hasActiveFilters && (
                <button
                  onClick={() => { setWorkspaceId(""); setMimeType(""); setDateFrom(""); setDateTo(""); }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:text-[#e5e2e1]"
                  style={{ color: "#8e9192" }}
                >
                  Clear filters
                </button>
              )}
              <button
                onClick={() => setPanelOpen((v) => !v)}
                className="lg:hidden px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:bg-[#2a2a2a]"
                style={{ border: "1px solid rgba(68,71,72,0.3)", color: "#c4c7c8" }}
              >
                {panelOpen ? "Hide info" : "Recent searches"}
              </button>
              <button
                onClick={() => runSearch(submittedQuery)}
                className="ml-auto px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:bg-[#2a2a2a]"
                style={{ border: "1px solid rgba(68,71,72,0.3)", color: "#c4c7c8" }}
              >
                Re-run with filters
              </button>
            </div>

            {/* Results */}
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div
                  className="w-8 h-8 rounded-full border-2 animate-spin"
                  style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
                />
              </div>
            ) : results.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-24 rounded-xl text-center"
                style={CARD_STYLE}
              >
                <span className="material-symbols-outlined mb-3" style={{ fontSize: 32, color: "#8e9192" }}>
                  search_off
                </span>
                <p className="font-medium" style={{ fontSize: 14, color: "#e5e2e1" }}>
                  No results for "{submittedQuery}"
                </p>
                <p className="mt-1" style={{ fontSize: 12, color: "#8e9192" }}>
                  Try a different query or clear your filters.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs mb-3" style={{ color: "#8e9192" }}>
                  {results.length} {results.length === 1 ? "result" : "results"} for "{submittedQuery}"
                </p>
                <div className="space-y-3">
                  {results.map((r, i) => {
                    const { icon, iconBg, iconColor } = fileIcon(r.mime_type ?? "");
                    return (
                      <div
                        key={`${r.document_id}-${r.chunk_index}-${i}`}
                        className="flex items-start gap-3 p-4 rounded-xl"
                        style={CARD_STYLE}
                      >
                        <div
                          className="w-9 h-9 rounded flex items-center justify-center shrink-0"
                          style={{ background: iconBg }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20, color: iconColor }}>
                            {icon}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="text-sm font-medium text-[#e5e2e1] truncate">{r.original_filename}</p>
                            <span className="text-xs shrink-0" style={{ color: "#8e9192" }}>
                              {r.page_number !== null ? `p. ${r.page_number}` : ""}
                            </span>
                          </div>
                          <p className="text-sm" style={{ color: "#c4c7c8", lineHeight: "20px" }}>
                            "{r.excerpt}"
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right panel */}
          <aside
            className={`${panelOpen ? "flex" : "hidden"} lg:flex w-full lg:w-64 shrink-0 overflow-y-auto p-4 sm:p-6 flex-col gap-6 order-first lg:order-last`}
            style={{ borderLeft: "1px solid rgba(68,71,72,0.1)" }}
          >
            <div>
              <p
                className="text-xs font-semibold uppercase mb-3"
                style={{ color: "#8e9192", letterSpacing: "0.1em" }}
              >
                How Search Works
              </p>
              <p className="text-xs" style={{ color: "#8e9192", lineHeight: "18px" }}>
                Results combine semantic (meaning-based) and keyword search across your
                documents, then are re-ranked for relevance.
              </p>
            </div>

            <div>
              <p
                className="text-xs font-semibold uppercase mb-3"
                style={{ color: "#8e9192", letterSpacing: "0.1em" }}
              >
                Recent Searches
              </p>
              {recentSearches.length === 0 ? (
                <p className="text-xs" style={{ color: "#8e9192" }}>No searches yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentSearches.map((s) => (
                    <button
                      key={s}
                      className="flex items-center gap-2 w-full text-sm text-left transition-colors hover:text-[#e5e2e1]"
                      style={{ color: "#c4c7c8" }}
                      onClick={() => { setQuery(s); runSearch(s); }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>history</span>
                      <span className="truncate">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
