import { api } from "@/lib/api";

export interface Workspace {
  id: number;
  name: string;
  is_default: boolean;
  document_count: number;
  created_at: string;
  updated_at: string | null;
}

export const workspaceService = {
  list() {
    return api.get<Workspace[]>("/workspaces/").then((r) => r.data);
  },
  create(name: string) {
    return api.post<Workspace>("/workspaces/", { name }).then((r) => r.data);
  },
  remove(id: number) {
    return api.delete(`/workspaces/${id}`).then(() => undefined);
  },
};
