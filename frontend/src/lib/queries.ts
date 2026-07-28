import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, apiPut } from "./api";
import type {
  Session,
  SessionSearchResult,
  SessionStatus,
  User,
  WeekSummary,
  MonthSummary,
  SeasonSummary,
  Goals,
  GarminStatus,
  ActivityProposal,
  GarminSyncResult,
} from "./types";

export const usersQuery = () =>
  queryOptions({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/api/users"),
  });

export const weekSummaryQuery = (user: string, isoWeek: string) =>
  queryOptions({
    queryKey: ["summary", "week", user, isoWeek],
    queryFn: () =>
      api<WeekSummary>(
        `/api/summary/week?user=${encodeURIComponent(user)}&iso_week=${encodeURIComponent(isoWeek)}`,
      ),
    enabled: Boolean(user && isoWeek),
  });

export const monthSummaryQuery = (user: string, yyyymm: string) =>
  queryOptions({
    queryKey: ["summary", "month", user, yyyymm],
    queryFn: () =>
      api<MonthSummary>(
        `/api/summary/month?user=${encodeURIComponent(user)}&yyyymm=${encodeURIComponent(yyyymm)}`,
      ),
    enabled: Boolean(user && yyyymm),
  });

export const monthSessionsQuery = (user: string, start: string, end: string) =>
  queryOptions({
    queryKey: ["sessions", user, start, end],
    queryFn: () =>
      api<Session[]>(`/api/sessions?user=${encodeURIComponent(user)}&from=${start}&to=${end}`),
    enabled: Boolean(user && start && end),
  });

export type SessionSearchFilters = {
  q?: string;
  status?: SessionStatus;
  form?: string;
  character?: string;
  competition?: boolean;
  hasLactate?: boolean;
  from?: string;
  to?: string;
};

export const sessionSearchQuery = (user: string, filters: SessionSearchFilters) =>
  infiniteQueryOptions({
    queryKey: ["sessions", "search", user, filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ user: user });
      if (filters.q) params.set("q", filters.q);
      if (filters.status) params.set("status", filters.status);
      if (filters.form) params.set("form", filters.form);
      if (filters.character) params.set("character", filters.character);
      if (filters.competition != null) params.set("competition", String(filters.competition));
      if (filters.hasLactate != null) params.set("has_lactate", String(filters.hasLactate));
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (pageParam) params.set("cursor", pageParam);
      return api<SessionSearchResult>(`/api/sessions/search?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SessionSearchResult) => last.next_cursor ?? undefined,
    enabled: Boolean(user),
  });

export const seasonSummaryQuery = (user: string, from: string, to: string, onlyDone = false) =>
  queryOptions({
    queryKey: ["summary", "season", user, from, to, onlyDone],
    queryFn: () =>
      api<SeasonSummary>(
        `/api/summary/season?user=${encodeURIComponent(user)}&from=${from}&to=${to}${onlyDone ? "&status=done" : ""}`,
      ),
    enabled: Boolean(user && from && to),
  });

export const goalsQuery = (user: string) =>
  queryOptions({
    queryKey: ["goals", user],
    queryFn: () => api<Goals>(`/api/goals?user=${encodeURIComponent(user)}`),
    enabled: Boolean(user),
  });

export function updateGoals(user: string, goals: Goals): Promise<Goals> {
  return apiPut<Goals>(`/api/goals?user=${encodeURIComponent(user)}`, goals);
}

export function updateUser(
  userId: string,
  patch: { name?: string; palette?: string | null },
): Promise<User> {
  return api<User>(`/api/users/${userId}`, { method: "PATCH", json: patch });
}

// ── Garmin ────────────────────────────────────────────────────────────────────

export const garminStatusQuery = (username: string) =>
  queryOptions({
    queryKey: ["garmin", "status", username],
    queryFn: () => api<GarminStatus>(`/api/garmin/status?user=${encodeURIComponent(username)}`),
    enabled: Boolean(username),
    staleTime: 30_000,
  });

export function garminConnect(
  username: string,
  body: { garmin_username: string; garmin_password: string },
): Promise<unknown> {
  return api(`/api/garmin/connect?user=${encodeURIComponent(username)}`, {
    method: "POST",
    json: body,
  });
}

export function garminMfa(username: string, mfa_code: string): Promise<unknown> {
  return api(`/api/garmin/mfa?user=${encodeURIComponent(username)}`, {
    method: "POST",
    json: { mfa_code },
  });
}

export function garminDisconnect(username: string): Promise<void> {
  return api<void>(`/api/garmin/disconnect?user=${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}

export function garminSyncPreview(
  username: string,
  start_date: string,
  end_date: string,
): Promise<ActivityProposal[]> {
  return api<ActivityProposal[]>(`/api/garmin/sync/preview?user=${encodeURIComponent(username)}`, {
    method: "POST",
    json: { start_date, end_date },
  });
}

export function garminSyncApply(
  username: string,
  items: Array<{
    garmin_activity_id: number;
    date: string;
    form: string | null;
    surface: string | null;
    duration_seconds: number;
    distance_km: number | null;
    activity_name: string | null;
    action: "match" | "create" | "skip";
    session_id?: string;
  }>,
): Promise<GarminSyncResult> {
  return api<GarminSyncResult>(`/api/garmin/sync/apply?user=${encodeURIComponent(username)}`, {
    method: "POST",
    json: { items },
  });
}
