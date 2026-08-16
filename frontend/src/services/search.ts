import { api } from "@/lib/api";

export interface SearchResult {
  document_id: number;
  original_filename: string;
  mime_type: string | null;
  chunk_index: number;
  page_number: number | null;
  excerpt: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface SearchFilters {
  workspaceId?: number;
  mimeType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const searchService = {
  search(query: string, filters?: SearchFilters) {
    return api
      .post<SearchResponse>("/search/", {
        query,
        workspace_id: filters?.workspaceId ?? null,
        mime_type: filters?.mimeType ?? null,
        date_from: filters?.dateFrom ?? null,
        date_to: filters?.dateTo ?? null,
      })
      .then((r) => r.data);
  },
};
