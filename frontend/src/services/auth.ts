import { api } from "@/lib/api";

export interface ProfileResponse {
  id: number;
  email: string;
  full_name: string;
}

export const authService = {
  updateProfile(body: { full_name?: string; current_password?: string; new_password?: string }) {
    return api.patch<ProfileResponse>("/auth/me", body).then((r) => r.data);
  },

  // Tokens are stateless JWTs, so this is advisory — the server has nothing to
  // invalidate today. Calling it anyway keeps the hook in place for when it does
  // (a Redis denylist), and failure must never block signing out locally.
  logout() {
    return api.post("/auth/logout").catch(() => undefined);
  },
};
