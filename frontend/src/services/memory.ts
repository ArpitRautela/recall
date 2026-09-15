import { api } from "@/lib/api";

export type ActivityEventType =
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_READY"
  | "DOCUMENT_FAILED"
  | "CONVERSATION_STARTED";

export type MemoryItemKind = "document" | "conversation";

export interface TimelineEvent {
  id: number;
  event_type: ActivityEventType;
  title: string;
  subtitle: string | null;
  document_id: number | null;
  conversation_id: number | null;
  created_at: string;
}

export interface FrequentItem {
  kind: MemoryItemKind;
  id: number;
  title: string;
  access_count: number;
}

export interface RecentItem {
  kind: MemoryItemKind;
  id: number;
  title: string;
  subtitle: string | null;
  status: string | null;
  chunk_count: number | null;
  updated_at: string;
}

export const memoryService = {
  timeline(limit = 50) {
    return api
      .get<TimelineEvent[]>("/memory/timeline", { params: { limit } })
      .then((r) => r.data);
  },
  frequent(limit = 5) {
    return api
      .get<FrequentItem[]>("/memory/frequent", { params: { limit } })
      .then((r) => r.data);
  },
  recent(limit = 8) {
    return api.get<RecentItem[]>("/memory/recent", { params: { limit } }).then((r) => r.data);
  },
};
