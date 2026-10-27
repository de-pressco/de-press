/**
 * API-клиент админки — единый origin через Vite proxy, credentials include
 * (Django session cookie). 401/403 → экран «нужен staff-доступ».
 */

import type {
  AdminHelper,
  AdminMe,
  AdminOverview,
  ModerationActionLog,
  ModerationResult,
  QueueCloud,
  ResolveBody,
  ResolveResponse,
  AdminReport,
} from "./types";

export type {
  AdminHelper,
  AdminMe,
  AdminOverview,
  AdminReport,
  ModerationActionLog,
  QueueCloud,
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown; message?: unknown };
      if (typeof data?.detail === "string") message = data.detail;
      else if (typeof data?.message === "string") message = data.message;
    } catch {
      // не JSON — оставляем «HTTP <code>»
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  overview: () => request<AdminOverview>("/admin/overview"),
  reports: (status: string, offset = 0) =>
    request<AdminReport[]>(
      `/admin/reports?status=${encodeURIComponent(status)}&limit=50&offset=${offset}`,
    ),
  resolveReport: (id: string, body: ResolveBody) =>
    request<ResolveResponse>(`/admin/reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  moderationLog: (offset = 0) =>
    request<ModerationActionLog[]>(`/admin/moderation-log?limit=100&offset=${offset}`),
  clouds: () => request<QueueCloud[]>("/moderation/clouds"),
  approveCloud: (id: string) =>
    request<ModerationResult>(`/moderation/clouds/${id}/approve`, { method: "POST" }),
  rejectCloud: (id: string) =>
    request<ModerationResult>(`/moderation/clouds/${id}/reject`, { method: "POST" }),
  helpers: () => request<AdminHelper[]>("/admin/helpers"),
  setHelperDuty: (id: string, on: boolean) =>
    request<AdminHelper>(`/admin/helpers/${id}/duty`, {
      method: "POST",
      body: JSON.stringify({ on }),
    }),
  // Own shift: /console/ and /helper are two doors of the same Helper role.
  me: () => request<AdminMe>("/me"),
  setDuty: (on: boolean) =>
    request<AdminMe>("/me/helper-duty", {
      method: "POST",
      body: JSON.stringify({ on }),
    }),
};
