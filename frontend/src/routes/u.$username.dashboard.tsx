import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { seasonSummaryQuery, goalsQuery, updateGoals } from "@/lib/queries";
import { secondsToHmm } from "@/lib/format";
import {
  WeeklyTrendChart,
  MonthlyComparisonChart,
  FormDistributionChart,
} from "@/components/TrainingCharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Goals } from "@/lib/types";

export const Route = createFileRoute("/u/$username/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { username } = Route.useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [onlyDone, setOnlyDone] = useState(false);

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const { data: season } = useQuery(seasonSummaryQuery(username, from, to, onlyDone));
  const { data: savedGoals } = useQuery(goalsQuery(username));

  const [editGoals, setEditGoals] = useState<Goals | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const totals = season?.totals;
  const weeks = season?.weeks ?? [];
  const weeksWithData = weeks.filter((w) => w.totals.session_count > 0).length;
  const activeGoals = editGoals ??
    savedGoals ?? {
      sessions_per_week: 0,
      hours_per_week: 0,
      km_per_week: 0,
    };

  const avgSessionsPerWeek = weeksWithData > 0 ? (totals?.session_count ?? 0) / weeksWithData : 0;
  const avgHoursPerWeek =
    weeksWithData > 0 ? (totals?.total_seconds ?? 0) / 3600 / weeksWithData : 0;
  const avgKmPerWeek = weeksWithData > 0 ? (totals?.total_distance_km ?? 0) / weeksWithData : 0;

  const handleSaveGoals = async () => {
    if (!editGoals) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateGoals(username, editGoals);
      await queryClient.invalidateQueries({ queryKey: ["goals", username] });
      setEditGoals(null);
    } catch {
      setSaveError(t("api.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl px-3 py-6 space-y-6">
      <div className="flex items-center gap-1 pb-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
          onClick={() => setYear((y) => String(Number(y) - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[52px] text-center text-sm font-semibold text-primary">{year}</div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
          onClick={() => setYear((y) => String(Number(y) + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="ml-auto">
          <ToggleGroup
            type="single"
            value={onlyDone ? "done" : "all"}
            onValueChange={(v) => v && setOnlyDone(v === "done")}
            className="h-7 gap-0 rounded-full border bg-muted p-0.5"
          >
            <ToggleGroupItem
              value="all"
              className="h-6 rounded-full px-3 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
            >
              {t("summary.filterAll")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="done"
              className="h-6 rounded-full px-3 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
            >
              {t("summary.filterDone")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label={t("dashboard.kpi.sessions")} value={totals?.session_count ?? 0} />
        <KpiCard
          label={t("dashboard.kpi.time")}
          value={secondsToHmm(totals?.total_seconds) || "0:00"}
        />
        <KpiCard
          label={t("dashboard.kpi.distance")}
          value={`${totals?.total_distance_km ?? 0} km`}
        />
        <KpiCard label={t("dashboard.kpi.quality")} value={totals?.quality_sessions ?? 0} />
      </div>

      {/* Goals */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b border-primary/15 bg-primary/[0.04] px-4 py-2.5 flex items-center justify-between">
          <p className="text-sm font-semibold text-primary">{t("dashboard.goals.title")}</p>
          {editGoals ? (
            <div className="flex items-center gap-2">
              {saveError && <span className="text-xs text-destructive">{saveError}</span>}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditGoals(null);
                  setSaveError(null);
                }}
              >
                {t("session.cancel")}
              </Button>
              <Button size="sm" onClick={handleSaveGoals} disabled={saving}>
                {t("dashboard.goals.save")}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditGoals({ ...activeGoals })}>
              {t("session.edit")}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 p-4">
          <GoalRow
            label={t("dashboard.goals.sessionsPerWeek")}
            target={activeGoals.sessions_per_week}
            actual={avgSessionsPerWeek}
            editing={!!editGoals}
            unit=""
            onChange={(v) =>
              setEditGoals((prev) => (prev ? { ...prev, sessions_per_week: v } : prev))
            }
          />
          <GoalRow
            label={t("dashboard.goals.hoursPerWeek")}
            target={activeGoals.hours_per_week}
            actual={avgHoursPerWeek}
            editing={!!editGoals}
            unit="h"
            onChange={(v) => setEditGoals((prev) => (prev ? { ...prev, hours_per_week: v } : prev))}
          />
          <GoalRow
            label={t("dashboard.goals.kmPerWeek")}
            target={activeGoals.km_per_week}
            actual={avgKmPerWeek}
            editing={!!editGoals}
            unit=" km"
            onChange={(v) => setEditGoals((prev) => (prev ? { ...prev, km_per_week: v } : prev))}
          />
        </div>
      </div>

      {/* Weekly trend */}
      <WeeklyTrendChart weeks={weeks} />

      {/* Character dist + monthly */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {totals && <FormDistributionChart totals={totals} />}
        <MonthlyComparisonChart weeks={weeks} />
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card text-center">
      <div className="h-[3px] bg-primary" />
      <div className="p-4">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

function GoalRow({
  label,
  target,
  actual,
  editing,
  unit,
  onChange,
}: {
  label: string;
  target: number;
  actual: number;
  editing: boolean;
  unit: string;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        {editing ? (
          <Input
            type="number"
            min="0"
            step="0.5"
            value={target}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-7 w-20 text-right text-sm"
          />
        ) : (
          <span className="font-medium">
            {fmt(target)}
            {unit}
          </span>
        )}
      </div>
      {!editing && (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {t("dashboard.goals.actual")}: {fmt(actual)}
            {unit} ({pct}%)
          </div>
        </>
      )}
    </div>
  );
}
