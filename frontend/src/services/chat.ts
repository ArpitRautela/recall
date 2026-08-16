import { api } from "@/lib/api";

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

export const chatService = {
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
