import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { monthSessionsQuery } from "@/lib/queries";
import { isoWeekOf, isoDate } from "@/lib/week";
import { FORMS, FORM_COLORS } from "@/lib/types";
import type { Totals, Session, WeekTrend } from "@/lib/types";

export function FormDistributionChart({ totals }: { totals: Totals }) {
  const { t } = useTranslation();

  const data = Object.entries(totals.by_form)
    .filter(([, v]) => v > 0)
    .map(([form, count]) => ({
      name: t(`form.${form}`),
      value: count,
      color: FORM_COLORS[form] ?? "#64748b",
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        —
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("summary.distribution")}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [v as number, t("summary.sessions")] as [number, string]}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeklyVolumeChart({
  username,
  yyyymm,
  metric = "hours",
  onlyDone = false,
}: {
  username: string;
  yyyymm: string;
  metric?: "hours" | "km";
  onlyDone?: boolean;
}) {
  const { t } = useTranslation();
  const [year, month] = yyyymm.split("-").map(Number);
  const start = `${yyyymm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${yyyymm}-${String(lastDay).padStart(2, "0")}`;

  const { data: allSessions = [] } = useQuery(monthSessionsQuery(username, start, end));
  const sessions = onlyDone ? allSessions.filter((s) => s.status === "done") : allSessions;

  // Aggregate per week per form
  const byWeek = new Map<string, Map<string, { seconds: number; km: number }>>();
  for (const s of sessions) {
    const wk = isoWeekOf(new Date(`${s.date}T00:00:00`));
    if (!byWeek.has(wk)) byWeek.set(wk, new Map());
    const formMap = byWeek.get(wk)!;
    for (const p of s.parts) {
      const form = p.form ?? "other";
      const curr = formMap.get(form) ?? { seconds: 0, km: 0 };
      curr.seconds += p.duration_seconds ?? 0;
      curr.km += p.distance_km ?? 0;
      formMap.set(form, curr);
    }
  }

  // Only show forms that have any data this month
  const activeForms = FORMS.filter((f) =>
    Array.from(byWeek.values()).some((fm) => {
      const d = fm.get(f);
      return d && (d.seconds > 0 || d.km > 0);
    }),
  );

  const weeklyData = Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([wk, formMap]) => {
      const entry: Record<string, number | string> = { week: `W${wk.split("-W")[1]}` };
      for (const form of activeForms) {
        const d = formMap.get(form) ?? { seconds: 0, km: 0 };
        entry[form] =
          metric === "hours"
            ? Math.round((d.seconds / 3600) * 10) / 10
            : Math.round(d.km * 10) / 10;
      }
      return entry;
    });

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("summary.weeklyVolume")}
      </p>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={weeklyData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={metric === "hours" ? "h" : "km"} />
          <Tooltip
            formatter={(v, name) =>
              [metric === "hours" ? `${v}h` : `${v} km`, t(`form.${name}`)] as [string, string]
            }
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v) => t(`form.${v}`)}
          />
          {activeForms.map((form) => (
            <Bar
              key={form}
              dataKey={form}
              stackId="a"
              fill={FORM_COLORS[form] ?? "#64748b"}
              name={form}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const CHARACTER_COLORS: Record<string, string> = {
  distance: "#10b981",
  interval: "#f97316",
  threshold: "#ef4444",
  vo2: "#8b5cf6",
  long: "#3b82f6",
  recovery: "#94a3b8",
  middle: "#22c55e",
  technique: "#eab308",
  fartlek: "#06b6d4",
  other: "#64748b",
};

export function CharacterDistributionChart({ totals }: { totals: Totals }) {
  const { t } = useTranslation();

  const data = Object.entries(totals.by_character ?? {})
    .filter(([, v]) => v > 0)
    .map(([char, count]) => ({
      name: t(`character.${char}`),
      value: count,
      color: CHARACTER_COLORS[char] ?? "#64748b",
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        —
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("dashboard.character")}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [v as number, t("summary.sessions")] as [number, string]}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeklyTrendChart({ weeks }: { weeks: WeekTrend[] }) {
  const { t } = useTranslation();

  const data = weeks.map((w) => ({
    week: `W${w.iso_week.split("-W")[1]}`,
    sessions: w.totals.session_count,
    hours: Math.round((w.totals.total_seconds / 3600) * 10) / 10,
    km: Math.round(w.totals.total_distance_km * 10) / 10,
  }));

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("dashboard.trend.title")}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 75, left: -15, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis yAxisId="hours" orientation="right" tick={{ fontSize: 11 }} unit="h" width={32} />
          <YAxis yAxisId="km" orientation="right" tick={{ fontSize: 11 }} unit="k" width={38} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="sessions"
            stroke="#f97316"
            dot={false}
            strokeWidth={2}
            name={t("dashboard.trend.sessions")}
            isAnimationActive={false}
          />
          <Line
            yAxisId="hours"
            type="monotone"
            dataKey="hours"
            stroke="#10b981"
            dot={false}
            strokeWidth={2}
            name={t("dashboard.trend.hours")}
            isAnimationActive={false}
          />
          <Line
            yAxisId="km"
            type="monotone"
            dataKey="km"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={2}
            name={t("dashboard.trend.km")}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyComparisonChart({ weeks }: { weeks: WeekTrend[] }) {
  const { t, i18n } = useTranslation();

  const byMonth = new Map<string, { sessions: number; hours: number; km: number }>();
  for (const w of weeks) {
    const month = w.start.slice(0, 7);
    const curr = byMonth.get(month) ?? { sessions: 0, hours: 0, km: 0 };
    curr.sessions += w.totals.session_count;
    curr.hours += w.totals.total_seconds / 3600;
    curr.km += w.totals.total_distance_km;
    byMonth.set(month, curr);
  }

  const data = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yyyymm, v]) => {
      const [year, month] = yyyymm.split("-").map(Number);
      const label = new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(
        new Date(year, month - 1, 1),
      );
      return {
        month: label,
        sessions: v.sessions,
        hours: Math.round(v.hours * 10) / 10,
        km: Math.round(v.km * 10) / 10,
      };
    });

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("dashboard.monthly")}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 55, left: -15, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis yAxisId="hours" orientation="right" tick={{ fontSize: 11 }} unit="h" width={32} />
          <YAxis yAxisId="km" orientation="right" tick={{ fontSize: 11 }} unit="k" width={38} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Bar
            yAxisId="left"
            dataKey="sessions"
            fill="#f97316"
            name={t("dashboard.trend.sessions")}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="hours"
            dataKey="hours"
            fill="#10b981"
            name={t("dashboard.trend.hours")}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="km"
            dataKey="km"
            fill="#3b82f6"
            name={t("dashboard.trend.km")}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyVolumeChart({ sessions, days }: { sessions: Session[]; days: Date[] }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<"time" | "km">("time");

  // Aggregate per day per form
  const byDate = new Map<string, Map<string, { seconds: number; km: number }>>();
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    const formMap = byDate.get(s.date)!;
    for (const p of s.parts) {
      const form = p.form ?? "other";
      const curr = formMap.get(form) ?? { seconds: 0, km: 0 };
      curr.seconds += p.duration_seconds ?? 0;
      curr.km += p.distance_km ?? 0;
      formMap.set(form, curr);
    }
  }

  const activeForms = FORMS.filter((f) =>
    days.some((d) => {
      const fm = byDate.get(isoDate(d));
      const entry = fm?.get(f);
      return entry && (entry.seconds > 0 || entry.km > 0);
    }),
  );

  const data = days.map((d) => {
    const iso = isoDate(d);
    const fm = byDate.get(iso);
    const entry: Record<string, number | string> = {
      day: new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(d),
    };
    for (const form of activeForms) {
      const v = fm?.get(form) ?? { seconds: 0, km: 0 };
      entry[form] = metric === "time" ? Math.round(v.seconds / 60) : Math.round(v.km * 10) / 10;
    }
    return entry;
  });

  const hasData = data.some((row) => activeForms.some((f) => (row[f] as number) > 0));
  if (!hasData) return null;

  return (
    <div className="mt-3 rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("summary.dailyVolume")}
        </p>
        <ToggleGroup
          type="single"
          value={metric}
          onValueChange={(v) => v && setMetric(v as "time" | "km")}
          className="h-6 gap-0 rounded-full border bg-muted p-0.5"
        >
          <ToggleGroupItem
            value="time"
            className="h-5 rounded-full px-2 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
          >
            {t("summary.time")}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="km"
            className="h-5 rounded-full px-2 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
          >
            km
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={data} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={metric === "time" ? "m" : "k"} />
          <Tooltip
            formatter={(v, name) =>
              [metric === "time" ? `${v} min` : `${v} km`, t(`form.${name}`)] as [string, string]
            }
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          {activeForms.map((form, i) => (
            <Bar
              key={form}
              dataKey={form}
              stackId="a"
              fill={FORM_COLORS[form] ?? "#64748b"}
              radius={i === activeForms.length - 1 ? [3, 3, 0, 0] : undefined}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
