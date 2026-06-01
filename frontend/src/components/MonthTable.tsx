import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { monthSessionsQuery } from "@/lib/queries";
import { computeTotals } from "@/lib/types";
import { km, secondsToHmm } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { shiftYyyyMm } from "@/lib/week";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FormDistributionChart, WeeklyVolumeChart } from "@/components/TrainingCharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Metric = "hours" | "km";

export function MonthTable({ username, yyyymm }: { username: string; yyyymm: string }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<Metric>("hours");
  const [onlyDone, setOnlyDone] = useState(false);

  const [year, month] = yyyymm.split("-").map(Number);
  const start = `${yyyymm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${yyyymm}-${String(lastDay).padStart(2, "0")}`;
  const { data: sessions = [] } = useQuery(monthSessionsQuery(username, start, end));

  const statSessions = onlyDone ? sessions.filter((s) => s.status === "done") : sessions;
  const totals = computeTotals(statSessions);

  const byFormSeconds: Record<string, number> = {};
  const byFormKm: Record<string, number> = {};
  for (const s of statSessions) {
    for (const p of s.parts) {
      const f = p.form ?? "other";
      byFormSeconds[f] = (byFormSeconds[f] ?? 0) + (p.duration_seconds ?? 0);
      byFormKm[f] = (byFormKm[f] ?? 0) + (p.distance_km ?? 0);
    }
  }

  const monthFmt = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" });
  const monthLabel = monthFmt.format(new Date(`${yyyymm}-01T00:00:00Z`));

  const forms = ["running", "orienteering", "strength", "cycling", "elliptical"] as const;

  return (
    <div className="container mx-auto space-y-4 p-3">
      <div className="flex items-center gap-2">
        <Link
          to="/u/$username/month/$yyyymm"
          params={{ username, yyyymm: shiftYyyyMm(yyyymm, -1) }}
        >
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-lg font-semibold capitalize text-primary">{monthLabel}</h2>
        <Link to="/u/$username/month/$yyyymm" params={{ username, yyyymm: shiftYyyyMm(yyyymm, 1) }}>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("summary.sessions")} value={String(totals.session_count)} />
        <Stat label={t("summary.time")} value={secondsToHmm(totals.total_seconds) || "0:00"} />
        <Stat label={t("summary.distance")} value={`${km(totals.total_distance_km)} km`} />
        <Stat label={t("summary.quality")} value={String(totals.quality_sessions)} />
        <Stat label={t("summary.avgKm")} value={`${km(totals.avg_km_per_session)} km`} />
        <Stat
          label={t("summary.avgTime")}
          value={secondsToHmm(totals.avg_seconds_per_session) || "0:00"}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <ToggleGroup
          type="single"
          value={onlyDone ? "done" : "all"}
          onValueChange={(v) => v && setOnlyDone(v === "done")}
          className="h-6 gap-0 rounded-full border bg-muted p-0.5"
        >
          <ToggleGroupItem
            value="all"
            className="h-5 rounded-full px-2 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
          >
            {t("summary.filterAll")}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="done"
            className="h-5 rounded-full px-2 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
          >
            {t("summary.filterDone")}
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={metric}
          onValueChange={(v) => v && setMetric(v as Metric)}
          className="h-6 gap-0 rounded-full border bg-muted p-0.5"
        >
          <ToggleGroupItem
            value="hours"
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

      <div className="grid gap-3 md:grid-cols-2">
        <FormDistributionChart totals={totals} />
        <WeeklyVolumeChart
          username={username}
          yyyymm={yyyymm}
          metric={metric}
          onlyDone={onlyDone}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-primary/15 bg-primary/[0.04] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">{t("session.form")}</th>
              {forms.map((f) => (
                <th key={f} className="p-2 text-left">
                  {t(`form.${f}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t text-xs text-muted-foreground">
              <td className="p-2">{t("summary.sessions")}</td>
              {forms.map((f) => (
                <td key={f} className="p-2 tabular-nums">
                  {totals.by_form?.[f] ?? 0}
                </td>
              ))}
            </tr>
            <tr className="border-t">
              <td className="p-2 text-xs text-muted-foreground">
                {metric === "hours" ? t("summary.time") : t("summary.distance")}
              </td>
              {forms.map((f) => (
                <td key={f} className="p-2 tabular-nums">
                  {metric === "hours"
                    ? secondsToHmm(byFormSeconds[f]) || "—"
                    : byFormKm[f]
                      ? `${km(byFormKm[f])} km`
                      : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg border bg-card px-4 py-3"
      style={{ borderLeft: "3px solid var(--primary)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
