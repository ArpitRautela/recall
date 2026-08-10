export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fileIcon(mimeType: string): { icon: string; iconBg: string; iconColor: string } {
  if (mimeType === "application/pdf") {
    return { icon: "picture_as_pdf", iconBg: "rgba(239,68,68,0.1)", iconColor: "#f87171" };
  }
  if (mimeType.includes("wordprocessingml")) {
    return { icon: "description", iconBg: "rgba(59,130,246,0.1)", iconColor: "#60a5fa" };
  }
  return { icon: "insert_drive_file", iconBg: "rgba(148,163,184,0.1)", iconColor: "#94a3b8" };
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}
