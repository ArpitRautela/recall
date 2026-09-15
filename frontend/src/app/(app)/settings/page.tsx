"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { authService } from "@/services/auth";
import { documentService, type StorageUsage } from "@/services/documents";
import { formatBytes } from "@/lib/format";
import { extractErrorMessage } from "@/lib/errors";

const TABS = [
  { key: "profile",    icon: "person",        label: "Profile" },
  { key: "workspace",  icon: "workspaces",    label: "Workspace" },
  { key: "ai",         icon: "smart_toy",     label: "AI Models" },
  { key: "notifs",     icon: "notifications", label: "Notifications" },
  { key: "vault",      icon: "folder",        label: "Vault" },
  { key: "security",   icon: "lock",          label: "Security" },
  { key: "appearance", icon: "palette",       label: "Appearance" },
  { key: "divider",    icon: "",              label: "" },
  { key: "integrations", icon: "extension",  label: "Integrations" },
  { key: "billing",    icon: "credit_card",   label: "Billing" },
  { key: "apikeys",    icon: "key",           label: "API Keys" },
  { key: "accounts",   icon: "link",          label: "Connected Accounts" },
  { key: "danger",     icon: "warning",       label: "Danger Zone" },
];

// Tabs backed by a real section. Everything else renders NOT_BUILT below, so the rail
// still shows the intended scope without pretending those settings exist.
const IMPLEMENTED_TABS = new Set(["profile", "ai", "vault"]);

const NOT_BUILT: Record<string, string> = {
  workspace: "Workspace-level defaults. Collections can be created and deleted from the Vault today; there are no per-workspace settings yet.",
  notifs: "Notification preferences. There is no notification system — recent activity is shown on the Memories page instead.",
  security: "Sessions, two-factor authentication and login history. Password changes currently live under Profile.",
  appearance: "Theme and display density. The interface is dark-only for now.",
  integrations: "Third-party connectors. Documents are added by direct upload only.",
  billing: "Plans, invoices and payment methods. RECALL has no billing system — storage usage is under Vault.",
  apikeys: "Programmatic API keys. The API is authenticated with session tokens only.",
  accounts: "Linked sign-in providers. Google sign-in works, but linked accounts can't be managed here yet.",
  danger: "Account deletion. Not implemented — deleting an account has to cascade across three separate stores.",
};

const CARD_STYLE = {
  background: "#201f1f",
  border: "1px solid rgba(68,71,72,0.1)",
};

// Mirrors the backend's actual configuration — see app/core/{embeddings,reranker}.py
// and ChatService. Displayed read-only because these are deployment-wide, not per-user.
const AI_STACK = [
  { label: "Chat Model", sub: "Generates answers and decides when to search.", value: "gpt-4o-mini" },
  { label: "Embedding Model", sub: "Converts documents and queries into vectors.", value: "bge-small-en-v1.5" },
  { label: "Reranker", sub: "Re-scores retrieved passages for relevance.", value: "ms-marco-MiniLM-L-6-v2" },
];

export default function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState("profile");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  useEffect(() => {
    documentService.usage().then(setUsage).catch(() => setUsage(null));
  }, []);

  const usedPct = usage && usage.quota_bytes > 0
    ? Math.round((usage.used_bytes / usage.quota_bytes) * 100)
    : 0;

  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      toast.error("Full name cannot be blank.");
      return;
    }
    if (newPassword && newPassword.length < 6) {
      toast.error("New password must be at least 6 characters.");
      return;
    }
    setSaving(true);
    try {
      const body: { full_name?: string; current_password?: string; new_password?: string } = {};
      if (fullName.trim() !== user?.full_name) body.full_name = fullName.trim();
      if (newPassword) {
        body.new_password = newPassword;
        if (currentPassword) body.current_password = currentPassword;
      }
      const updated = await authService.updateProfile(body);
      setUser(updated);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to update profile."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative h-full overflow-y-auto" style={{ background: "#131313" }}>
      <div
        className="fixed bottom-0 right-0 w-1/2 h-1/2 rounded-full pointer-events-none -z-10"
        style={{ background: "rgba(192,193,255,0.05)", filter: "blur(120px)", transform: "translate(33%,33%)" }}
      />

      {/* Page header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-2 text-sm" style={{ color: "#c4c7c8" }}>
          <span style={{ color: "#e5e2e1", fontWeight: 500 }}>Settings</span>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
          <span>{TABS.find((t) => t.key === activeTab)?.label ?? activeTab}</span>
        </div>
      </div>

      <div className="flex px-8 pb-8 gap-6">
        {/* Left tabs */}
        <aside className="w-52 shrink-0">
          <div className="space-y-0.5">
            {TABS.map((t) => {
              if (t.key === "divider") {
                return <div key="div" className="h-px my-2" style={{ background: "rgba(68,71,72,0.2)" }} />;
              }
              const isDanger = t.key === "danger";
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                    color: isDanger ? "#f87171" : isActive ? "#e5e2e1" : "#c4c7c8",
                    borderLeft: isActive ? "2px solid #e5e2e1" : "2px solid transparent",
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: isDanger ? "#f87171" : undefined }}>
                    {t.icon}
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-6">
          {activeTab === "profile" && (
          <div className="p-6 rounded-xl" style={CARD_STYLE}>
            <h2 className="font-semibold text-[#ffffff] mb-1" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
              User Profile
            </h2>
            <p className="text-sm mb-6" style={{ color: "#c4c7c8" }}>
              Manage your personal information and how it appears to others.
            </p>

            <div className="flex gap-6">
              {/* Avatar */}
              <div className="shrink-0">
                <div
                  className="w-28 h-28 rounded-xl flex items-center justify-center text-3xl font-bold"
                  style={{ background: "rgba(192,193,255,0.15)", color: "#c0c1ff" }}
                >
                  {user?.full_name?.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() ?? "U"}
                </div>
                <p className="text-xs mt-2 text-center" style={{ color: "#8e9192" }}>
                  Initials from your name
                </p>
              </div>

              {/* Form */}
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#c4c7c8" }}>
                      Full Name
                    </label>
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-3 py-2 rounded text-sm outline-none"
                      style={{ background: "#131313", border: "1px solid rgba(68,71,72,0.3)", color: "#e5e2e1" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#c4c7c8" }}>
                      Email Address
                    </label>
                    <input
                      value={email}
                      disabled
                      title="Email cannot be changed"
                      className="w-full px-3 py-2 rounded text-sm outline-none opacity-60 cursor-not-allowed"
                      style={{ background: "#131313", border: "1px solid rgba(68,71,72,0.3)", color: "#e5e2e1" }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#c4c7c8" }}>
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Required to change password"
                      className="w-full px-3 py-2 rounded text-sm outline-none"
                      style={{ background: "#131313", border: "1px solid rgba(68,71,72,0.3)", color: "#e5e2e1" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "#c4c7c8" }}>
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Leave blank to keep current"
                      className="w-full px-3 py-2 rounded text-sm outline-none"
                      style={{ background: "#131313", border: "1px solid rgba(68,71,72,0.3)", color: "#e5e2e1" }}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleSaveProfile}
                    disabled={saving}
                    className="px-5 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: "#ffffff", color: "#131313" }}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}

          {activeTab === "ai" && (
          <div className="p-6 rounded-xl" style={CARD_STYLE}>
            <h2 className="font-semibold text-[#ffffff] mb-1" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
              AI Inference Configuration
            </h2>
            <p className="text-sm mb-6" style={{ color: "#c4c7c8" }}>
              The models currently powering retrieval and answers.
            </p>

            <div className="space-y-5">
              {AI_STACK.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#e5e2e1]">{item.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: "#c4c7c8" }}>{item.sub}</p>
                  </div>
                  <span
                    className="px-3 py-1.5 rounded text-xs font-mono shrink-0 ml-4"
                    style={{ background: "#131313", border: "1px solid rgba(68,71,72,0.3)", color: "#c0c1ff" }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
              <p className="text-xs pt-1" style={{ color: "#8e9192" }}>
                These are deployment-wide settings, not per-account preferences.
              </p>
            </div>
          </div>
          )}

          {activeTab === "vault" && (
          <div className="p-6 rounded-xl" style={CARD_STYLE}>
            <h2 className="font-semibold text-[#ffffff] mb-1" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>
              Storage
            </h2>
            <p className="text-sm mb-6" style={{ color: "#c4c7c8" }}>
              How much of your quota your uploaded documents are using.
            </p>

            {usage === null ? (
              <p className="text-sm" style={{ color: "#8e9192" }}>Loading usage…</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[#e5e2e1]">
                    {formatBytes(usage.used_bytes)} of {formatBytes(usage.quota_bytes)}
                  </span>
                  <span className="text-sm" style={{ color: usedPct >= 85 ? "#facc15" : "#8e9192" }}>
                    {usedPct}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full" style={{ background: "#353534" }}>
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(usedPct, 100)}%`,
                      background: usedPct >= 85 ? "#facc15" : "#c0c1ff",
                    }}
                  />
                </div>
                {usedPct >= 85 && (
                  <p className="text-xs mt-3" style={{ color: "#c4c7c8" }}>
                    You are nearing your storage limit. Delete documents to free space.
                  </p>
                )}
              </>
            )}
          </div>
          )}

          {!IMPLEMENTED_TABS.has(activeTab) && (
            <div className="p-6 rounded-xl" style={CARD_STYLE}>
              <div className="flex items-start gap-3">
                <span
                  className="material-symbols-outlined shrink-0 mt-0.5"
                  style={{ fontSize: 20, color: "#8e9192" }}
                >
                  construction
                </span>
                <div>
                  <h2
                    className="font-semibold text-[#ffffff] mb-1"
                    style={{ fontSize: 20, letterSpacing: "-0.02em" }}
                  >
                    {TABS.find((t) => t.key === activeTab)?.label} — not built yet
                  </h2>
                  <p className="text-sm" style={{ color: "#c4c7c8", lineHeight: "22px" }}>
                    {NOT_BUILT[activeTab] ?? "This section has not been implemented."}
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
