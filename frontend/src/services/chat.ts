import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export type MessageRole = "user" | "assistant";

export interface ChatSource {
  document_id: number;
  original_filename: string;
  chunk_index: number;
  page_number: number | null;
  excerpt: string;
}

export interface ChatMessage {
  id: number;
  role: MessageRole;
  content: string;
  sources: ChatSource[] | null;
  created_at: string;
}

export interface ChatResponse {
  conversation_id: number;
  message: ChatMessage;
}

export interface ConversationSummary {
  id: number;
  title: string | null;
  updated_at: string | null;
  message_count: number;
  preview: string | null;
}

export interface ConversationDetail {
  id: number;
  title: string | null;
  created_at: string;
  messages: ChatMessage[];
}

export interface StreamHandlers {
  onMeta?: (conversationId: number) => void;
  onSearching?: () => void;
  onSources?: (sources: ChatSource[]) => void;
  onToken?: (text: string) => void;
  onDone?: (messageId: number, sources: ChatSource[] | null) => void;
  onError?: (detail: string) => void;
}

/** Parses an SSE byte stream into (event, data) pairs. */
async function readSSE(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; keep the trailing partial in the buffer.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      let event = "";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!event || !data) continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event) {
        case "meta":
          handlers.onMeta?.(payload.conversation_id as number);
          break;
        case "searching":
          handlers.onSearching?.();
          break;
        case "sources":
          handlers.onSources?.((payload.sources as ChatSource[]) ?? []);
          break;
        case "token":
          handlers.onToken?.(payload.text as string);
          break;
        case "done":
          handlers.onDone?.(
            payload.message_id as number,
            (payload.sources as ChatSource[] | null) ?? null
          );
          break;
        case "error":
          handlers.onError?.((payload.detail as string) ?? "Something went wrong.");
          break;
      }
    }
  }
}

export const chatService = {
  /**
   * Streams one chat turn.
   *
   * Uses fetch rather than the shared axios instance, because axios can't expose a
   * response body as a stream in the browser. That means bypassing the 401-refresh
   * interceptor in lib/api.ts — so a cheap authenticated request is made first to let
   * that interceptor refresh if needed, and only then is the token read for the stream.
   */
  async streamMessage(
    message: string,
    conversationId: number | null | undefined,
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    await api.get("/auth/me");
    const token = useAuthStore.getState().accessToken;

    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ conversation_id: conversationId ?? null, message }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Chat stream failed (${res.status})`);
    }
    await readSSE(res.body, handlers);
  },

  sendMessage(message: string, conversationId?: number | null) {
    return api
      .post<ChatResponse>("/chat/", {
        conversation_id: conversationId ?? null,
        message,
      })
      .then((r) => r.data);
  },

  listConversations() {
    return api.get<ConversationSummary[]>("/chat/conversations").then((r) => r.data);
  },

  getConversation(id: number) {
    return api.get<ConversationDetail>(`/chat/conversations/${id}`).then((r) => r.data);
  },
};
