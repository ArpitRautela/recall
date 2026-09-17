"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { documentService, type RecallDocument } from "@/services/documents";
import { chatService, type ConversationSummary } from "@/services/chat";
import { formatBytes, formatRelativeTime, fileIcon } from "@/lib/format";
import { extractErrorMessage } from "@/lib/errors";

const QUICK_ACTIONS = [
  {
    icon: "chat_bubble",
    label: "Ask a Question",
    desc: "Query your knowledge base instantly.",
    iconBg: "rgba(49,49,192,0.2)",
    iconColor: "#c0c1ff",
    href: "/chat/new",
  },
  {
    icon: "description",
    label: "Upload Documents",
    desc: "Add PDFs and docs for analysis.",
    iconBg: "rgba(99,101,101,0.2)",
    iconColor: "#ffffff",
    href: "/vault",
  },
  {
    icon: "search",
    label: "Search Memories",
    desc: "Find exact moments from past chats.",
    iconBg: "rgba(53,53,52,0.5)",
    iconColor: "#ffffff",
    href: "/search",
  },
  {
    icon: "restore",
    label: "Continue Chat",
    desc: "Pick up exactly where you left off.",
    iconBg: "rgba(226,226,226,0.2)",
    iconColor: "#ffffff",
    href: "/conversations",
  },
];

const ALLOWED_EXTENSIONS = [".pdf", ".docx"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

export default function DashboardPage() {
  const { user } = useAuthStore();
  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [documents, setDocuments] = useState<RecallDocument[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const docs = await documentService.list();
      setDocuments(docs.slice(0, 3));
    } catch {
      toast.error("Failed to load recent files.");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    chatService
      .listConversations()
      .then((convs) => setConversations(convs.slice(0, 4)))
      .catch(() => toast.error("Failed to load recent activity."))
      .finally(() => setLoadingConvs(false));
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);

    await Promise.all(
      Array.from(files).map(async (file) => {
        const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          toast.error(`${file.name} isn't a supported file type (PDF or DOCX only).`);
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} exceeds the 50MB limit.`);
          return;
        }
        try {
          await documentService.upload(file);
          toast.success(`${file.name} uploaded — processing started.`);
        } catch (err) {
          toast.error(extractErrorMessage(err, `Failed to upload ${file.name}.`));
        }
      })
    );

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fetchDocuments();
  };

  return (
    <div className="relative p-4 sm:p-8 overflow-y-auto h-full" style={{ background: "#131313" }}>

      {/* Atmospheric glow */}
      <div
        className="fixed bottom-0 right-0 w-1/2 h-1/2 rounded-full pointer-events-none -z-10"
        style={{
          background: "rgba(192,193,255,0.05)",
          filter: "blur(120px)",
          transform: "translate(33%, 33%)",
        }}
      />

      {/* Welcome Hero */}
      <section className="mb-12 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h2
              className="font-semibold text-[#ffffff] mb-1"
              style={{ fontSize: "clamp(24px, 6vw, 32px)", lineHeight: 1.25, letterSpacing: "-0.03em" }}
            >
              {getGreeting()}, {firstName}
            </h2>
            <p style={{ fontSize: 16, lineHeight: "24px", letterSpacing: "-0.011em", color: "#c4c7c8" }}>
              What would you like to remember today?
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link
              href="/chat/new"
              className="flex items-center gap-2 px-6 py-2.5 rounded font-bold text-sm transition-opacity hover:opacity-90"
              style={{ background: "#ffffff", color: "#131313", boxShadow: "0 4px 12px rgba(255,255,255,0.1)" }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
              >
                add
              </span>
              Start New Chat
            </Link>
            <Link
              href="/vault"
              className="flex items-center gap-2 px-6 py-2.5 rounded font-medium text-sm transition-all hover:bg-white/5"
              style={{ border: "1px solid rgba(68,71,72,0.3)", color: "#ffffff" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                upload_file
              </span>
              Upload Files
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 sm:mb-12">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="p-6 rounded-xl cursor-pointer transition-all hover:bg-[#2a2a2a] group"
            style={CARD_STYLE}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
              style={{ background: a.iconBg }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 22, color: a.iconColor }}
              >
                {a.icon}
              </span>
            </div>
            <h3
              className="font-medium text-[#ffffff] mb-1"
              style={{ fontSize: 18, lineHeight: "28px", letterSpacing: "-0.01em" }}
            >
              {a.label}
            </h3>
            <p style={{ fontSize: 12, lineHeight: "16px", letterSpacing: "0.02em", color: "#c4c7c8" }}>
              {a.desc}
            </p>
          </Link>
        ))}
      </section>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3
              className="font-semibold text-[#ffffff]"
              style={{ fontSize: 24, letterSpacing: "-0.02em" }}
            >
              Recent Activity
            </h3>
            <Link
              href="/conversations"
              className="text-xs font-medium uppercase tracking-widest transition-colors hover:text-[#e5e2e1]"
              style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}
            >
              View All
            </Link>
          </div>

          {loadingConvs ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="w-6 h-6 rounded-full border-2 animate-spin"
                style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
              />
            </div>
          ) : conversations.length === 0 ? (
            <div
              className="p-8 rounded-xl text-center cursor-pointer transition-all hover:border-white/20"
              style={{ ...CARD_STYLE, border: "2px dashed rgba(68,71,72,0.2)" }}
            >
              <Link href="/chat/new" className="block">
                <span className="material-symbols-outlined mb-2" style={{ fontSize: 28, color: "#8e9192" }}>
                  chat_bubble
                </span>
                <p style={{ fontSize: 14, color: "#e5e2e1" }}>No conversations yet</p>
                <p className="mt-1" style={{ fontSize: 12, color: "#8e9192" }}>
                  Start a chat to see it show up here.
                </p>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {conversations.map((c) => (
                <Link
                  key={c.id}
                  href={`/chat/${c.id}`}
                  className="p-6 rounded-xl transition-all hover:border-white/20 cursor-pointer block"
                  style={CARD_STYLE}
                >
                  <div className="flex justify-between items-start mb-4">
                    <h4
                      className="font-medium text-[#e5e2e1] pr-2"
                      style={{ fontSize: 18, lineHeight: "28px", letterSpacing: "-0.01em" }}
                    >
                      {c.title || "Untitled conversation"}
                    </h4>
                    <span style={{ fontSize: 11, color: "#c4c7c8" }} className="shrink-0">
                      {c.updated_at ? formatRelativeTime(c.updated_at) : ""}
                    </span>
                  </div>
                  <p
                    className="line-clamp-2 mb-6"
                    style={{ fontSize: 14, lineHeight: "20px", color: "#c4c7c8" }}
                  >
                    {c.preview || "No messages yet."}
                  </p>
                  <div
                    className="flex items-center gap-4"
                    style={{ fontSize: 12, color: "#c4c7c8" }}
                  >
                    <div className="flex items-center gap-1">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        forum
                      </span>
                      <span>{c.message_count} {c.message_count === 1 ? "msg" : "msgs"}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Vault */}
        <div className="lg:col-span-1">
          <div className="flex items-center justify-between mb-6">
            <h3
              className="font-semibold text-[#ffffff]"
              style={{ fontSize: 24, letterSpacing: "-0.02em" }}
            >
              Vault
            </h3>
            <Link
              href="/vault"
              className="text-xs font-medium uppercase tracking-widest transition-colors hover:text-[#e5e2e1]"
              style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}
            >
              Library
            </Link>
          </div>

          {loadingDocs ? (
            <div className="flex items-center justify-center py-8">
              <div
                className="w-6 h-6 rounded-full border-2 animate-spin"
                style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
              />
            </div>
          ) : (
            <div className="space-y-4 mb-4">
              {documents.map((d) => {
                const { icon, iconBg, iconColor } = fileIcon(d.mime_type);
                return (
                  <Link
                    key={d.id}
                    href="/vault"
                    className="flex items-center p-4 rounded-xl group cursor-pointer transition-all hover:border-white/20"
                    style={CARD_STYLE}
                  >
                    <div
                      className="w-10 h-10 rounded flex items-center justify-center mr-4 shrink-0"
                      style={{ background: iconBg }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 22, color: iconColor }}
                      >
                        {icon}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-medium truncate"
                        style={{ fontSize: 14, color: "#e5e2e1" }}
                      >
                        {d.original_filename}
                      </p>
                      <p className="mt-0.5" style={{ fontSize: 12, color: "#8e9192" }}>
                        {formatBytes(d.file_size)} • {formatRelativeTime(d.created_at)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Drop zone */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              handleFiles(e.dataTransfer.files);
            }}
            className="rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:border-white/20 group"
            style={{
              border: dragActive ? "2px dashed #c0c1ff" : "2px dashed rgba(68,71,72,0.2)",
              background: dragActive ? "rgba(192,193,255,0.05)" : "rgba(28,27,27,0.3)",
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors group-hover:bg-white/10"
              style={{ background: "#2a2a2a" }}
            >
              <span
                className="material-symbols-outlined transition-colors group-hover:text-white"
                style={{ fontSize: 22, color: "#c4c7c8" }}
              >
                {uploading ? "hourglass_top" : "cloud_upload"}
              </span>
            </div>
            <p className="font-medium" style={{ fontSize: 14, color: "#e5e2e1" }}>
              {uploading ? "Uploading..." : "Drop files here"}
            </p>
            <p className="mt-1" style={{ fontSize: 12, color: "#8e9192" }}>
              or click to browse from device
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
