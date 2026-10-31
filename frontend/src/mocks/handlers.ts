// MSW handlers mirroring the FastAPI routes under backend/routers/*.
// In-memory + localStorage-backed persistence under "mock-backend-v1".

import { http, HttpResponse } from "msw";
import { RUNNING_FORMS } from "@/lib/types";
import type { Session, User, Goals } from "@/lib/types";

const STORAGE_KEY = "mock-backend-v1";
const QUALITY_INTENSITIES = new Set(["threshold", "vo2", "max"]);

type Store = { users: User[]; sessions: Session[]; goals: Record<string, Goals> };

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): Store {
  return {
    users: [{ id: uuid(), name: "demo", created_at: nowIso(), palette: null }],
    sessions: [],
    goals: {},
  };
}

let _store: Store | null = null;

function loadStore(): Store {
  if (_store) return _store;
  if (typeof localStorage === "undefined") {
    _store = emptyStore();
    return _store;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      _store = emptyStore();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_store));
      return _store;
    }
    const stored = JSON.parse(raw) as Store;
    if (!stored.goals) stored.goals = {};
    for (const u of stored.users) {
      if (!("palette" in u)) (u as User).palette = null;
    }
    for (const s of stored.sessions) {
      if (!Array.isArray(s.parts)) {
        // migrate flat fields → parts array
        const raw = s as unknown as Record<string, unknown>;
        const legacyForms: string[] = Array.isArray(raw.forms)
          ? (raw.forms as string[])
          : typeof raw.form === "string"
            ? [raw.form as string]
            : [];
        const legacyChar = (raw.character as string | null) ?? null;
        const legacySurface = (raw.surface as string | null) ?? null;
        const legacyDuration = (raw.duration_seconds as number | null) ?? null;
        const legacyDistance = (raw.distance_km as number | null) ?? null;
        const legacyRpe = (raw.rpe as number | null) ?? null;
        s.parts =
          legacyForms.length > 0
            ? legacyForms.map((form, i) => ({
                form,
                character: i === 0 ? legacyChar : null,
                surface: i === 0 ? legacySurface : null,
                duration_seconds: i === 0 ? legacyDuration : null,
                distance_km: i === 0 ? legacyDistance : null,
                rpe: i === 0 ? legacyRpe : null,
              }))
            : [
                {
                  form: null,
                  character: legacyChar,
                  surface: legacySurface,
                  duration_seconds: legacyDuration,
                  distance_km: legacyDistance,
                  rpe: legacyRpe,
                },
              ];
      }
      if (!Array.isArray(s.lactate_measurements)) {
        s.lactate_measurements = [];
      }
    }
    _store = stored;
    return _store;
  } catch {
    _store = emptyStore();
    return _store;
  }
}

function saveStore(store: Store) {
  _store = store;
  if (typeof localStorage === "undefined") return;
  // Defer the write so it never blocks the main thread during event handling
  setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // ignore quota errors
    }
  }, 0);
}

function resolveUserByName(store: Store, name: string) {
  return store.users.find((u) => u.name === name);
}

function isoWeekRange(isoWeek: string): [string, string] {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(isoWeek);
  if (!m) throw new Error("iso_week must look like 2026-W22");
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function monthRange(yyyymm: string): [string, string] {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) throw new Error("yyyymm must look like 2026-05");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = `${m[1]}-${m[2]}-01`;
  const endDate = new Date(Date.UTC(y, mo, 0));
  return [start, endDate.toISOString().slice(0, 10)];
}

function aggregate(sessions: Session[], running = false) {
  if (running) {
    sessions = sessions
      .map((s) => ({ ...s, parts: s.parts.filter((p) => RUNNING_FORMS.has(p.form ?? "")) }))
      .filter((s) => s.parts.length > 0);
  }
  const allParts = sessions.flatMap((s) => s.parts);
  const total_seconds = allParts.reduce((a, p) => a + (p.duration_seconds || 0), 0);
  const runningParts = allParts.filter((p) => RUNNING_FORMS.has(p.form ?? ""));
  const total_distance = runningParts.reduce((a, p) => a + (p.distance_km || 0), 0);
  const quality = sessions.filter((s) =>
    s.parts.some((p) => QUALITY_INTENSITIES.has(p.intensity || "") || p.competition),
  ).length;
  const by_form: Record<string, number> = {};
  const by_character: Record<string, number> = {};
  for (const p of allParts) {
    if (p.form) by_form[p.form] = (by_form[p.form] || 0) + 1;
    if (p.character) by_character[p.character] = (by_character[p.character] || 0) + 1;
  }
  const n = sessions.length;
  return {
    session_count: n,
    total_seconds,
    total_distance_km: Math.round(total_distance * 100) / 100,
    quality_sessions: quality,
    by_form,
    by_character,
    avg_km_per_session: n ? Math.round((total_distance / n) * 100) / 100 : 0,
    avg_seconds_per_session: n ? Math.floor(total_seconds / n) : 0,
  };
}

function isoWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toIsoWeekLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  // Thursday of the same week always belongs to the correct ISO year
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const thu = new Date(d);
  thu.setUTCDate(d.getUTCDate() - dow + 3);
  const year = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const weekNum = Math.floor((d.getTime() - week1Mon.getTime()) / (7 * 86400 * 1000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

export const handlers = [
  http.get("/api/health", () => HttpResponse.json({ ok: true })),

  // ---------- users ----------
  http.get("/api/users", () => {
    const store = loadStore();
    return HttpResponse.json([...store.users].sort((a, b) => a.name.localeCompare(b.name)));
  }),
  http.post("/api/users", async ({ request }) => {
    const body = (await request.json()) as { name?: string; palette?: string | null };
    const name = String(body?.name ?? "").trim();
    if (!name) return HttpResponse.json({ detail: "Name is required" }, { status: 400 });
    const store = loadStore();
    const existing = resolveUserByName(store, name);
    if (existing) return HttpResponse.json(existing, { status: 201 });
    const user: User = { id: uuid(), name, created_at: nowIso(), palette: body?.palette ?? null };
    store.users.push(user);
    saveStore(store);
    return HttpResponse.json(user, { status: 201 });
  }),
  http.patch("/api/users/:id", async ({ params, request }) => {
    const store = loadStore();
    const id = String(params.id);
    const user = store.users.find((u) => u.id === id);
    if (!user) return HttpResponse.json({ detail: "User not found" }, { status: 404 });
    const body = (await request.json()) as { name?: string; palette?: string | null };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return HttpResponse.json({ detail: "Name is required" }, { status: 400 });
      if (store.users.some((u) => u.name === name && u.id !== id))
        return HttpResponse.json({ detail: "Name already taken" }, { status: 409 });
      user.name = name;
    }
    if ("palette" in body) user.palette = body.palette ?? null;
    saveStore(store);
    return HttpResponse.json(user);
  }),
  http.delete("/api/users/:id", ({ params }) => {
    const store = loadStore();
    const id = String(params.id);
    const idx = store.users.findIndex((u) => u.id === id);
    if (idx === -1) return HttpResponse.json({ detail: "User not found" }, { status: 404 });
    store.users.splice(idx, 1);
    store.sessions = store.sessions.filter((s) => s.user_id !== id);
    saveStore(store);
    return new HttpResponse(null, { status: 204 });
  }),

  // ---------- sessions ----------
  http.get("/api/sessions/search", ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const q = url.searchParams.get("q")?.toLowerCase() || null;
    const status = url.searchParams.get("status");
    const form = url.searchParams.get("form");
    const character = url.searchParams.get("character");
    const competition = url.searchParams.get("competition");
    const hasLactate = url.searchParams.get("has_lactate");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const cursor = url.searchParams.get("cursor");
    const store = loadStore();
    const u = resolveUserByName(store, userName);
    if (!u) return HttpResponse.json({ detail: `Unknown user: ${userName}` }, { status: 404 });
    const matches = store.sessions
      .filter((s) => s.user_id === u.id)
      .filter((s) => (from ? s.date >= from : true))
      .filter((s) => (to ? s.date <= to : true))
      .filter((s) => (status ? s.status === status : true))
      .filter((s) =>
        q
          ? (s.name?.toLowerCase().includes(q) ?? false) ||
            (s.comment?.toLowerCase().includes(q) ?? false)
          : true,
      )
      .filter((s) => (form ? s.parts.some((p) => p.form === form) : true))
      .filter((s) => (character ? s.parts.some((p) => p.character === character) : true))
      .filter((s) =>
        competition != null
          ? s.parts.some((p) => p.competition) === (competition === "true")
          : true,
      )
      .filter((s) =>
        hasLactate != null ? s.lactate_measurements.length > 0 === (hasLactate === "true") : true,
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.session_no - a.session_no);
    let page = matches;
    if (cursor) {
      const at = cursor.lastIndexOf(":");
      const cDate = cursor.slice(0, at);
      const cNo = Number(cursor.slice(at + 1));
      page = matches.filter((s) => s.date < cDate || (s.date === cDate && s.session_no < cNo));
    }
    const items = page.slice(0, limit);
    const hasMore = page.length > items.length;
    const last = items[items.length - 1];
    return HttpResponse.json({
      items,
      has_more: hasMore,
      next_cursor: hasMore && last ? `${last.date}:${last.session_no}` : null,
      total: cursor ? null : matches.length,
    });
  }),

  http.get("/api/sessions", ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const store = loadStore();
    const u = resolveUserByName(store, userName);
    if (!u) return HttpResponse.json({ detail: `Unknown user: ${userName}` }, { status: 404 });
    const list = store.sessions
      .filter((s) => s.user_id === u.id)
      .filter((s) => (from ? s.date >= from : true))
      .filter((s) => (to ? s.date <= to : true))
      .sort((a, b) => a.date.localeCompare(b.date) || a.session_no - b.session_no);
    return HttpResponse.json(list);
  }),
  http.post("/api/sessions", async ({ request }) => {
    const payload = (await request.json()) as Partial<Session>;
    const store = loadStore();
    if (!payload?.user_id || !store.users.find((u) => u.id === payload.user_id)) {
      return HttpResponse.json({ detail: "Unknown user_id" }, { status: 404 });
    }
    const name = String(payload.name ?? "").trim();
    const session: Session = {
      id: uuid(),
      user_id: payload.user_id!,
      date: payload.date!,
      session_no: payload.session_no ?? 1,
      name,
      parts: Array.isArray(payload.parts) ? payload.parts : [],
      lactate_measurements: Array.isArray(payload.lactate_measurements)
        ? payload.lactate_measurements
        : [],
      status: payload.status ?? "planned",
      comment: payload.comment ?? null,
    };
    store.sessions.push(session);
    saveStore(store);
    return HttpResponse.json(session, { status: 201 });
  }),
  http.patch("/api/sessions/:id", async ({ params, request }) => {
    const store = loadStore();
    const id = String(params.id);
    const idx = store.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return HttpResponse.json({ detail: "Session not found" }, { status: 404 });
    const body = (await request.json()) as Partial<Session>;
    store.sessions[idx] = { ...store.sessions[idx], ...body };
    saveStore(store);
    return HttpResponse.json(store.sessions[idx]);
  }),
  http.post("/api/sessions/reorder", async ({ request }) => {
    const body = (await request.json()) as { ids?: string[] };
    const ids = body?.ids ?? [];
    const store = loadStore();
    for (let i = 0; i < ids.length; i++) {
      const idx = store.sessions.findIndex((s) => s.id === ids[i]);
      if (idx === -1)
        return HttpResponse.json({ detail: `Session not found: ${ids[i]}` }, { status: 404 });
      store.sessions[idx] = { ...store.sessions[idx], session_no: i + 1 };
    }
    saveStore(store);
    return HttpResponse.json({ reordered: ids.length });
  }),
  http.delete("/api/sessions/:id", ({ params }) => {
    const store = loadStore();
    const id = String(params.id);
    const idx = store.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return HttpResponse.json({ detail: "Session not found" }, { status: 404 });
    store.sessions.splice(idx, 1);
    saveStore(store);
    return new HttpResponse(null, { status: 204 });
  }),

  // ---------- goals ----------
  http.get("/api/goals", ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const store = loadStore();
    const g = store.goals[userName] ?? { sessions_per_week: 0, hours_per_week: 0, km_per_week: 0 };
    return HttpResponse.json(g);
  }),
  http.put("/api/goals", async ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const body = (await request.json()) as Goals;
    const store = loadStore();
    store.goals[userName] = {
      sessions_per_week: body.sessions_per_week ?? 0,
      hours_per_week: body.hours_per_week ?? 0,
      km_per_week: body.km_per_week ?? 0,
    };
    saveStore(store);
    return HttpResponse.json(store.goals[userName]);
  }),

  // ---------- summary ----------
  http.get("/api/summary/season", ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const store = loadStore();
    const u = resolveUserByName(store, userName);
    if (!u) return HttpResponse.json({ detail: `Unknown user: ${userName}` }, { status: 404 });
    const statusFilter = url.searchParams.get("status");
    const running = url.searchParams.get("running") === "true";
    const allSessions = store.sessions
      .filter((s) => s.user_id === u.id && s.date >= from && s.date <= to)
      .filter((s) => !statusFilter || s.status === statusFilter)
      .sort((a, b) => a.date.localeCompare(b.date));
    const weeks = [];
    let cur = from || to;
    while (cur <= to) {
      const d = new Date(`${cur}T00:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7; // Mon=0, Sun=6
      const wkEnd = addDays(cur, 6 - dow);
      const clippedEnd = wkEnd > to ? to : wkEnd;
      const isoWeek = toIsoWeekLabel(cur);
      const wkSessions = allSessions.filter((s) => s.date >= cur && s.date <= clippedEnd);
      weeks.push({
        iso_week: isoWeek,
        start: cur,
        end: clippedEnd,
        totals: aggregate(wkSessions, running),
      });
      cur = addDays(clippedEnd, 1);
    }
    return HttpResponse.json({ from, to, weeks, totals: aggregate(allSessions, running) });
  }),
  http.get("/api/summary/week", ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const isoWeek = url.searchParams.get("iso_week") || "";
    const store = loadStore();
    const u = resolveUserByName(store, userName);
    if (!u) return HttpResponse.json({ detail: `Unknown user: ${userName}` }, { status: 404 });
    let start: string;
    let end: string;
    try {
      [start, end] = isoWeekRange(isoWeek);
    } catch (e) {
      return HttpResponse.json({ detail: (e as Error).message }, { status: 400 });
    }
    const sessions = store.sessions
      .filter((s) => s.user_id === u.id && s.date >= start && s.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.session_no - b.session_no);
    return HttpResponse.json({
      iso_week: isoWeek,
      start,
      end,
      sessions,
      totals: aggregate(sessions),
    });
  }),
  http.get("/api/summary/month", ({ request }) => {
    const url = new URL(request.url);
    const userName = url.searchParams.get("user") || "";
    const yyyymm = url.searchParams.get("yyyymm") || "";
    const store = loadStore();
    const u = resolveUserByName(store, userName);
    if (!u) return HttpResponse.json({ detail: `Unknown user: ${userName}` }, { status: 404 });
    let start: string;
    let end: string;
    try {
      [start, end] = monthRange(yyyymm);
    } catch (e) {
      return HttpResponse.json({ detail: (e as Error).message }, { status: 400 });
    }
    const sessions = store.sessions.filter(
      (s) => s.user_id === u.id && s.date >= start && s.date <= end,
    );
    return HttpResponse.json({
      yyyymm,
      start,
      end,
      totals: aggregate(sessions),
    });
  }),
];

export function resetMockBackend() {
  _store = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}
