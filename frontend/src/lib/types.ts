export type User = { id: string; name: string; created_at: string; palette?: string | null };

export type SessionStatus = "planned" | "done" | "skipped";

export type SessionPart = {
  form: string | null;
  character: string | null;
  intensity?: string | null;
  surface: string | null;
  duration_seconds: number | null;
  distance_km: number | null;
  rpe: number | null;
  competition?: boolean | null;
};

export type Session = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  session_no: number;
  name: string | null;
  parts: SessionPart[];
  status: SessionStatus;
  comment: string | null;
};

export function sessionDuration(s: Session): number | null {
  const t = s.parts.reduce((a, p) => a + (p.duration_seconds ?? 0), 0);
  return t > 0 ? t : null;
}
export function sessionDistance(s: Session): number | null {
  const d = s.parts.reduce((a, p) => a + (p.distance_km ?? 0), 0);
  return d > 0 ? d : null;
}

export type Totals = {
  session_count: number;
  total_seconds: number;
  total_distance_km: number;
  quality_sessions: number;
  by_form: Record<string, number>;
  by_character?: Record<string, number>;
  avg_km_per_session: number;
  avg_seconds_per_session: number;
};

export type WeekSummary = {
  iso_week: string;
  start: string;
  end: string;
  sessions: Session[];
  totals: Totals;
};

export type MonthSummary = {
  yyyymm: string;
  start: string;
  end: string;
  totals: Totals;
};

export const FORMS = [
  "running",
  "orienteering",
  "strength",
  "cycling",
  "elliptical",
  "other",
] as const;

export const CHARACTERS = [
  "distance",
  "interval",
  "tempo",
  "long",
  "middle",
  "technique",
  "fartlek",
  "lowerbody",
  "upperbody",
  "fullbody",
  "other",
] as const;

export const INTENSITIES = ["threshold", "vo2", "recovery"] as const;
export type SessionIntensity = (typeof INTENSITIES)[number];

export const SURFACES = [
  "trail",
  "gravel",
  "road",
  "forest",
  "gym",
  "track",
  "treadmill",
  "other",
] as const;

export type SessionForm = (typeof FORMS)[number];
export type SessionCharacter = (typeof CHARACTERS)[number];
export type SessionSurface = (typeof SURFACES)[number];

type FormRules = {
  characters: readonly SessionCharacter[];
  surfaces: readonly SessionSurface[];
  /** Whether distance_km is meaningful for this form */
  hasDistance: boolean;
};

export const FORM_RULES: Record<SessionForm, FormRules> = {
  running: {
    characters: ["distance", "interval", "tempo", "fartlek", "other"],
    surfaces: ["trail", "gravel", "road", "forest", "track", "treadmill"],
    hasDistance: true,
  },
  orienteering: {
    characters: ["long", "middle", "technique", "distance", "interval", "other"],
    surfaces: ["forest", "road"],
    hasDistance: true,
  },
  strength: {
    characters: ["upperbody", "lowerbody", "fullbody"],
    surfaces: ["gym"],
    hasDistance: false,
  },
  cycling: {
    characters: ["distance", "interval", "tempo", "fartlek", "other"],
    surfaces: ["road", "gravel", "trail", "gym"],
    hasDistance: true,
  },
  elliptical: {
    characters: ["distance", "interval", "tempo", "other"],
    surfaces: ["gym"],
    hasDistance: false,
  },
  other: {
    characters: CHARACTERS,
    surfaces: SURFACES,
    hasDistance: true,
  },
} satisfies Record<SessionForm, FormRules>;

/** Returns the rules for a given form, falling back to all options when form is null/unknown. */
export function formRules(form: string | null | undefined): FormRules {
  if (form && form in FORM_RULES) return FORM_RULES[form as SessionForm];
  return { characters: CHARACTERS, surfaces: SURFACES, hasDistance: true };
}

export const STATUSES: SessionStatus[] = ["planned", "done", "skipped"];

export type WeekTrend = { iso_week: string; start: string; end: string; totals: Totals };

export type SeasonSummary = {
  from: string;
  to: string;
  weeks: WeekTrend[];
  totals: Totals;
};

export type Goals = {
  sessions_per_week: number;
  hours_per_week: number;
  km_per_week: number;
};

export const FORM_COLORS: Record<string, string> = {
  running: "#10b981",
  orienteering: "#f97316",
  strength: "#8b5cf6",
  cycling: "#3b82f6",
  elliptical: "#06b6d4",
  other: "#64748b",
};
