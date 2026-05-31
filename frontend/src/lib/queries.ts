import { queryOptions } from "@tanstack/react-query";
import { api, apiPut } from "./api";
import type { Session, User, WeekSummary, MonthSummary, SeasonSummary, Goals } from "./types";

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

export const seasonSummaryQuery = (user: string, from: string, to: string) =>
  queryOptions({
    queryKey: ["summary", "season", user, from, to],
    queryFn: () =>
      api<SeasonSummary>(
        `/api/summary/season?user=${encodeURIComponent(user)}&from=${from}&to=${to}`,
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
