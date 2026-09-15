import axios from "axios";

export type DependencyStatus = "up" | "down";

export interface ReadinessReport {
  status: "ready" | "degraded";
  dependencies: Record<string, { status: DependencyStatus; error?: string }>;
}

// /health and /health/ready sit at the server root, not under /api/v1, so this
// can't go through the shared `api` instance. It's also unauthenticated by design —
// an orchestrator has no bearer token.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");

export const healthService = {
  ready() {
    return axios
      .get<ReadinessReport>(`${ORIGIN}/health/ready`, {
        timeout: 8000,
        // 503 is an expected answer here (degraded), not a transport failure.
        validateStatus: (s) => s === 200 || s === 503,
      })
      .then((r) => r.data);
  },
};
