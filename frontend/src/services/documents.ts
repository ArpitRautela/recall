import { api } from "@/lib/api";

export type DocumentStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export interface RecallDocument {
  id: number;
  workspace_id: number;
  original_filename: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  status: DocumentStatus;
  chunk_count: number;
  error_message: string | null;
  updated_at: string | null;
}

export interface DocumentChunk {
  chunk_index: number;
  page_number: number | null;
  content: string;
  token_count: number;
}

export interface StorageUsage {
  used_bytes: number;
  quota_bytes: number;
}

export const documentService = {
  usage() {
    return api.get<StorageUsage>("/documents/usage").then((r) => r.data);
  },

  upload(file: File, opts?: { workspaceId?: number; onProgress?: (percent: number) => void }) {
    const formData = new FormData();
    formData.append("file", file);
    if (opts?.workspaceId != null) formData.append("workspace_id", String(opts.workspaceId));
    return api
      .post<RecallDocument>("/documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (opts?.onProgress && evt.total) {
            opts.onProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        },
      })
      .then((r) => r.data);
  },

  list(workspaceId?: number) {
    return api
      .get<RecallDocument[]>("/documents/", {
        params: workspaceId != null ? { workspace_id: workspaceId } : {},
      })
      .then((r) => r.data);
  },

  getChunks(id: number) {
    return api.get<DocumentChunk[]>(`/documents/${id}/chunks`).then((r) => r.data);
  },

  remove(id: number) {
    return api.delete(`/documents/${id}`).then(() => undefined);
  },

  reprocess(id: number) {
    return api.post<RecallDocument>(`/documents/${id}/reprocess`).then((r) => r.data);
  },
};
