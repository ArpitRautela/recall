"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import {
  chatService,
  type ChatMessage,
  type ChatSource,
} from "@/services/chat";
import { extractErrorMessage } from "@/lib/errors";

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

const MODEL_LABEL = "gpt-4o-mini";

// Describes what the backend actually does — see ChatService._make_search_tool.
const CONTEXT_STEPS = [
  {
    title: "Your question becomes a vector",
    detail: "It's embedded locally and matched against every chunk of your READY documents.",
  },
  {
    title: "Top candidates are re-ranked",
    detail: "A cross-encoder re-scores the shortlist, because vector similarity alone ranks topically-close but unhelpful passages too highly.",
  },
  {
    title: "Only strong matches are used",
    detail: "Passages below the relevance threshold are dropped — if nothing clears it, the assistant says so instead of guessing.",
  },
  {
    title: "Answers cite what they used",
    detail: "Each source above shows the document, page number, and the exact excerpt the answer drew on.",
  },
];

interface GroupedSource {
  name: string;
  pages: string;
  excerpts: { page: number | null; text: string }[];
}

function groupSources(sources: ChatSource[]): GroupedSource[] {
  const byDoc = new Map<
    number,
    { name: string; pages: Set<number>; excerpts: { page: number | null; text: string }[] }
  >();
  for (const s of sources) {
    const entry = byDoc.get(s.document_id) ?? { name: s.original_filename, pages: new Set(), excerpts: [] };
    if (s.page_number !== null) entry.pages.add(s.page_number);
    if (!entry.excerpts.some((e) => e.text === s.excerpt)) {
      entry.excerpts.push({ page: s.page_number, text: s.excerpt });
    }
    byDoc.set(s.document_id, entry);
  }
  return Array.from(byDoc.values()).map((d) => ({
    name: d.name,
    pages: d.pages.size > 0 ? `p. ${Array.from(d.pages).sort((a, b) => a - b).join(", ")}` : "",
    excerpts: d.excerpts,
  }));
}

const CODE_STYLE: React.CSSProperties = {
  background: "rgba(68,71,72,0.4)",
  padding: "1px 5px",
  borderRadius: 3,
  fontFamily: "monospace",
  fontSize: 12,
  color: "#c0c1ff",
};

// Builds React nodes rather than an HTML string. Assistant text quotes passages from
// user-uploaded documents, so anything rendered as raw HTML would be an injection vector.
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++} style={{ color: "#e5e2e1" }}>{match[1]}</strong>);
    } else {
      nodes.push(<code key={key++} style={CODE_STYLE}>{match[2]}</code>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const parts: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      parts.push(
        <div key={i} className="my-3 rounded-lg overflow-hidden" style={{ background: "#0e0e0e" }}>
          <div
            className="px-4 py-2 flex items-center justify-between"
            style={{ background: "#1c1b1b", borderBottom: "1px solid rgba(68,71,72,0.2)" }}
          >
            <span className="text-xs" style={{ color: "#8e9192" }}>{lang || "text"}</span>
          </div>
          <pre
            className="px-4 py-4 text-xs overflow-x-auto"
            style={{ color: "#c4c7c8", lineHeight: "1.8", fontFamily: "monospace" }}
          >
            {codeLines.join("\n")}
          </pre>
        </div>
      );
    } else if (line) {
      parts.push(
        <p
          key={i}
          className="text-sm mb-2"
          style={{ color: "#c4c7c8", lineHeight: "22px" }}
        >
          {renderInline(line)}
        </p>
      );
    }
    i++;
  }

  return <div>{parts}</div>;
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [conversationId, setConversationId] = useState<number | null>(
    params.id === "new" ? null : Number(params.id)
  );
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [initialLoading, setInitialLoading] = useState(params.id !== "new");
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const [showContextHelp, setShowContextHelp] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isNew = conversationId === null;

  const loadConversation = useCallback(async (id: number) => {
    try {
      const conv = await chatService.getConversation(id);
      setTitle(conv.title);
      setMessages(conv.messages);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't load that conversation."));
      router.replace("/chat/new");
    } finally {
      setInitialLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (params.id !== "new") {
      loadConversation(Number(params.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const optimisticUserMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      sources: null,
      created_at: new Date().toISOString(),
    };
    // Placeholder the tokens stream into. Negative id so it can't collide with a real one.
    const streamingId = -Date.now();
    setMessages((prev) => [
      ...prev,
      optimisticUserMsg,
      { id: streamingId, role: "assistant", content: "", sources: null, created_at: new Date().toISOString() },
    ]);
    setInput("");
    setSending(true);
    setSearching(false);

    const patchStreaming = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === streamingId ? fn(m) : m)));

    let streamFailed = false;
    try {
      await chatService.streamMessage(text, conversationId, {
        onMeta: (newId) => {
          if (isNew) {
            setConversationId(newId);
            setTitle(text.slice(0, 60) + (text.length > 60 ? "…" : ""));
            router.replace(`/chat/${newId}`);
          }
        },
        onSearching: () => setSearching(true),
        onSources: (sources) => {
          setSearching(false);
          patchStreaming((m) => ({ ...m, sources: sources.length ? sources : null }));
        },
        onToken: (chunk) => {
          setSearching(false);
          patchStreaming((m) => ({ ...m, content: m.content + chunk }));
        },
        onDone: (messageId, sources) =>
          patchStreaming((m) => ({ ...m, id: messageId, sources: sources ?? m.sources })),
        onError: (detail) => {
          streamFailed = true;
          toast.error(detail);
        },
      });
    } catch (err) {
      streamFailed = true;
      toast.error(extractErrorMessage(err, "Failed to send message. Try again."));
    } finally {
      setSending(false);
      setSearching(false);
      // Drop the placeholder only if nothing ever arrived, so a partial answer is kept.
      if (streamFailed) {
        setMessages((prev) => prev.filter((m) => !(m.id === streamingId && !m.content)));
      }
    }
  };

  const initials = user?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "U";

  const allSources = messages.flatMap((m) => m.sources ?? []);
  const groupedSources = groupSources(allSources);
  const showEmptyState = isNew && messages.length === 0 && !sending;

  return (
    <div className="flex h-full" style={{ background: "#131313" }}>
      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Chat header */}
        <div
          className="px-6 py-3 flex items-center justify-between shrink-0"
          style={{ borderBottom: "1px solid rgba(68,71,72,0.1)", background: "#131313" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2
              className="font-semibold text-[#e5e2e1] truncate"
              style={{ fontSize: 15, maxWidth: 400 }}
            >
              {isNew ? "New Chat" : title || "Conversation"}
            </h2>
            {!isNew && (
              <>
                <span
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs shrink-0"
                  style={{ background: "rgba(192,193,255,0.15)", color: "#c0c1ff" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>auto_awesome</span>
                  {MODEL_LABEL}
                </span>
                {groupedSources.length > 0 && (
                  <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: "#8e9192" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>
                    {groupedSources.length} {groupedSources.length === 1 ? "source" : "sources"}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowContext(!showContext)}
              className="p-1.5 rounded-lg transition-colors hover:bg-[#2a2a2a]"
              style={{ color: showContext ? "#c0c1ff" : "#8e9192" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>side_navigation</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {initialLoading ? (
            <div className="flex items-center justify-center h-full">
              <div
                className="w-8 h-8 rounded-full border-2 animate-spin"
                style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
              />
            </div>
          ) : showEmptyState ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "rgba(192,193,255,0.1)" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 32, color: "#c0c1ff" }}>
                  chat_bubble
                </span>
              </div>
              <h3 className="font-semibold text-[#e5e2e1] mb-2" style={{ fontSize: 20 }}>
                Start a new conversation
              </h3>
              <p style={{ color: "#c4c7c8", fontSize: 14 }}>
                Ask anything about your memories, files, or knowledge base.
              </p>
            </div>
          ) : (
            <div className="space-y-6 max-w-3xl mx-auto">
              {messages.map((msg) => {
                const sourceGroups = msg.sources ? groupSources(msg.sources) : [];
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {msg.role === "assistant" && (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1"
                        style={{ background: "rgba(192,193,255,0.2)" }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#c0c1ff" }}>
                          auto_awesome
                        </span>
                      </div>
                    )}
                    <div
                      className="max-w-xl px-4 py-3 rounded-2xl"
                      style={
                        msg.role === "user"
                          ? { background: "#353534", borderRadius: "18px 18px 4px 18px" }
                          : { background: "transparent" }
                      }
                    >
                      <MessageContent content={msg.content} />
                      {sourceGroups.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {sourceGroups.map((s) => (
                            <span
                              key={s.name}
                              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                              style={{ background: "#353534", color: "#c4c7c8" }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>description</span>
                              {s.name}{s.pages ? ` (${s.pages})` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 text-xs font-bold"
                        style={{ background: "rgba(192,193,255,0.2)", color: "#c0c1ff" }}
                      >
                        {initials}
                      </div>
                    )}
                  </div>
                );
              })}
              {sending && !messages.some((m) => m.id < 0 && m.content) && (
                <div className="flex gap-3 justify-start">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1"
                    style={{ background: "rgba(192,193,255,0.2)" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#c0c1ff" }}>
                      auto_awesome
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-2">
                    {searching ? (
                      <>
                        <span
                          className="material-symbols-outlined animate-pulse"
                          style={{ fontSize: 16, color: "#c0c1ff" }}
                        >
                          search
                        </span>
                        <span className="text-sm" style={{ color: "#c4c7c8" }}>
                          Searching your documents…
                        </span>
                      </>
                    ) : (
                      [0, 1, 2].map((d) => (
                        <span
                          key={d}
                          className="w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ background: "#8e9192", animationDelay: `${d * 150}ms` }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-6 pb-6 pt-2 shrink-0">
          {!isNew && (
            <p className="text-center text-xs mb-2" style={{ color: "#8e9192", letterSpacing: "0.05em" }}>
              AI CAN MAKE MISTAKES. VERIFY IMPORTANT INFO.
            </p>
          )}
          <div
            className="rounded-xl p-3"
            style={{ background: "#201f1f", border: "1px solid rgba(68,71,72,0.2)" }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              disabled={sending}
              placeholder="Ask about your memory stack or uploaded files..."
              rows={2}
              className="w-full bg-transparent outline-none resize-none text-sm disabled:opacity-60"
              style={{ color: "#e5e2e1", caretColor: "#c0c1ff" }}
            />
            <div className="flex items-center justify-end mt-2">
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
                style={{ background: input.trim() && !sending ? "#e5e2e1" : "#353534" }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 18,
                    color: input.trim() && !sending ? "#131313" : "#8e9192",
                    fontVariationSettings: "'FILL' 1",
                  }}
                >
                  send
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Context panel */}
      {showContext && !isNew && (
        <aside
          className="w-72 shrink-0 flex flex-col overflow-y-auto"
          style={{ borderLeft: "1px solid rgba(68,71,72,0.1)", background: "#0e0e0e" }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between shrink-0"
            style={{ borderBottom: "1px solid rgba(68,71,72,0.1)" }}
          >
            <p
              className="text-xs font-semibold uppercase"
              style={{ color: "#c0c1ff", letterSpacing: "0.1em" }}
            >
              Context Panel
            </p>
            <button
              onClick={() => setShowContext(false)}
              className="transition-colors hover:text-[#e5e2e1]"
              style={{ color: "#8e9192" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            {/* Connected knowledge — real sources actually used in this conversation */}
            <div>
              <p
                className="text-xs font-semibold uppercase mb-3"
                style={{ color: "#8e9192", letterSpacing: "0.1em" }}
              >
                Sources Referenced
              </p>
              {groupedSources.length === 0 ? (
                <p className="text-xs" style={{ color: "#8e9192" }}>
                  No documents referenced in this conversation yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {groupedSources.map((s) => (
                    <div key={s.name} className="p-3 rounded-xl" style={CARD_STYLE}>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded flex items-center justify-center shrink-0"
                          style={{ background: "rgba(239,68,68,0.1)" }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#f87171" }}>
                            description
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#e5e2e1] truncate">{s.name}</p>
                          {s.pages && (
                            <p className="text-xs mt-0.5" style={{ color: "#8e9192" }}>{s.pages}</p>
                          )}
                        </div>
                      </div>
                      {s.excerpts.length > 0 && (
                        <div className="mt-2.5 space-y-1.5 pl-1">
                          {s.excerpts.map((e, i) => (
                            <p
                              key={i}
                              className="text-xs pl-2"
                              style={{
                                color: "#8e9192",
                                lineHeight: "17px",
                                borderLeft: "2px solid rgba(192,193,255,0.25)",
                              }}
                            >
                              {e.page !== null && (
                                <span style={{ color: "#c0c1ff" }}>p.{e.page} — </span>
                              )}
                              "{e.text}"
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => setShowContextHelp((v) => !v)}
                className="flex items-center gap-2 text-xs transition-colors hover:text-[#e5e2e1]"
                style={{ color: showContextHelp ? "#c0c1ff" : "#8e9192" }}
                aria-expanded={showContextHelp}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>help_outline</span>
                How context works
              </button>
              {showContextHelp && (
                <div className="mt-3 p-3 rounded-xl space-y-2" style={CARD_STYLE}>
                  {CONTEXT_STEPS.map((step, i) => (
                    <div key={step.title} className="flex gap-2.5">
                      <span
                        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: "rgba(192,193,255,0.15)", color: "#c0c1ff" }}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#e5e2e1]">{step.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: "#8e9192", lineHeight: "16px" }}>
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
