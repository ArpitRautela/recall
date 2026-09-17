"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { memoryService, type FrequentItem, type RecentItem } from "@/services/memory";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: string;
  href: string;
}

const DESTINATIONS: Command[] = [
  { id: "nav-chat", label: "New chat", icon: "add_comment", group: "Go to", href: "/chat/new" },
  { id: "nav-dashboard", label: "Dashboard", icon: "history", group: "Go to", href: "/dashboard" },
  { id: "nav-vault", label: "Vault", icon: "folder", group: "Go to", href: "/vault" },
  { id: "nav-search", label: "Search", icon: "search", group: "Go to", href: "/search" },
  { id: "nav-memories", label: "Memories", icon: "psychology", group: "Go to", href: "/memories" },
  { id: "nav-settings", label: "Settings", icon: "settings", group: "Go to", href: "/settings" },
];

function itemHref(kind: string, id: number) {
  // Vault has no per-document route, so documents open the list.
  return kind === "document" ? "/vault" : `/chat/${id}`;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [frequent, setFrequent] = useState<FrequentItem[]>([]);

  // ⌘K / Ctrl+K anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onExternalOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("recall:open-palette", onExternalOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("recall:open-palette", onExternalOpen);
    };
  }, []);

  // Load once per opening so the list reflects recent activity.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    memoryService.recent(8).then(setRecent).catch(() => setRecent([]));
    memoryService.frequent(5).then(setFrequent).catch(() => setFrequent([]));
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const seen = new Set<string>();
    const fromRecent = recent.map((r) => {
      const id = `${r.kind}-${r.id}`;
      seen.add(id);
      return {
        id: `recent-${id}`,
        label: r.title,
        hint: r.kind === "document" ? "Document" : "Conversation",
        icon: r.kind === "document" ? "description" : "forum",
        group: "Recent",
        href: itemHref(r.kind, r.id),
      };
    });
    const fromFrequent = frequent
      .filter((f) => !seen.has(`${f.kind}-${f.id}`))
      .map((f) => ({
        id: `frequent-${f.kind}-${f.id}`,
        label: f.title,
        hint: `Opened ${f.access_count}×`,
        icon: f.kind === "document" ? "description" : "forum",
        group: "Frequent",
        href: itemHref(f.kind, f.id),
      }));
    return [...DESTINATIONS, ...fromRecent, ...fromFrequent];
  }, [recent, frequent]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const grouped = useMemo(() => {
    const out: { group: string; items: Command[] }[] = [];
    for (const c of filtered) {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.items.push(c);
      else out.push({ group: c.group, items: [c] });
    }
    return out;
  }, [filtered]);

  const run = (c: Command) => {
    setOpen(false);
    router.push(c.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[cursor]) {
      e.preventDefault();
      run(filtered[cursor]);
    }
  };

  // Flat index so arrow keys move across group boundaries.
  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 overflow-hidden top-[15%] translate-y-0 sm:max-w-xl"
        style={{ background: "#1c1b1b", border: "1px solid rgba(68,71,72,0.4)" }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid rgba(68,71,72,0.3)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#8e9192" }}>
            search
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, document or conversation…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "#e5e2e1" }}
          />
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "rgba(68,71,72,0.4)", color: "#8e9192" }}
          >
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center" style={{ color: "#8e9192" }}>
              No matches for &ldquo;{query}&rdquo;
            </p>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-1">
                <p
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase"
                  style={{ color: "#8e9192", letterSpacing: "0.1em" }}
                >
                  {section.group}
                </p>
                {section.items.map((c) => {
                  flatIndex += 1;
                  const active = flatIndex === cursor;
                  const myIndex = flatIndex;
                  return (
                    <button
                      key={c.id}
                      onClick={() => run(c)}
                      onMouseEnter={() => setCursor(myIndex)}
                      className="flex items-center gap-3 w-full px-4 py-2 text-left transition-colors"
                      style={{ background: active ? "rgba(255,255,255,0.06)" : "transparent" }}
                    >
                      <span
                        className="material-symbols-outlined shrink-0"
                        style={{ fontSize: 18, color: active ? "#c0c1ff" : "#8e9192" }}
                      >
                        {c.icon}
                      </span>
                      <span className="text-sm truncate" style={{ color: "#e5e2e1" }}>
                        {c.label}
                      </span>
                      {c.hint && (
                        <span className="ml-auto text-xs shrink-0" style={{ color: "#8e9192" }}>
                          {c.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
