import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { monthSessionsQuery } from "@/lib/queries";
import { isoDate, isoWeekOf, shiftIsoWeek, weekDays } from "@/lib/week";
import { secondsToHmm } from "@/lib/format";
import { FORMS, FORM_COLORS } from "@/lib/types";
import type { Session } from "@/lib/types";

const MIXED_COLOR = "#eab308";

type Metric = "km" | "hours";

type DayVolume = { seconds: number; km: number; forms: Set<string> };

const PAGE_SIZE = 8;
const MAX_BUBBLE = 44;
const MIN_BUBBLE = 8;

function aggregateByDay(sessions: Session[]): Map<string, DayVolume> {
  const byDay = new Map<string, DayVolume>();
  for (const s of sessions) {
    const day = byDay.get(s.date) ?? { seconds: 0, km: 0, forms: new Set<string>() };
    for (const p of s.parts) {
      day.seconds += p.duration_seconds ?? 0;
      day.km += p.distance_km ?? 0;
      day.forms.add(p.form ?? "other");
    }
    byDay.set(s.date, day);
  }
  return byDay;
}

function dayColor(forms: Set<string>): string {
  if (forms.size !== 1) return MIXED_COLOR;
  const [form] = forms;
  return FORM_COLORS[form] ?? FORM_COLORS.other;
}

function bubbleSize(value: number, max: number): number {
  if (max <= 0 || value <= 0) return MIN_BUBBLE;
  return Math.max(MIN_BUBBLE, Math.sqrt(value / max) * MAX_BUBBLE);
}

function formatValue(metric: Metric, v: { seconds: number; km: number }): string {
  return metric === "km" ? `${Math.round(v.km * 10) / 10} km` : secondsToHmm(v.seconds) || "0:00";
}

export function TrainingLog({
  username,
  year,
  onlyDone,
}: {
  username: string;
  year: string;
  onlyDone: boolean;
}) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<Metric>("km");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const today = new Date();
  const lastWeek =
    String(today.getFullYear()) === year
      ? isoWeekOf(today)
      : isoWeekOf(new Date(Number(year), 11, 28));
  const firstWeek = isoWeekOf(new Date(Number(year), 0, 4));
  const weeks: string[] = [];
  for (let w = lastWeek; w >= firstWeek; w = shiftIsoWeek(w, -1)) weeks.push(w);
  const shown = weeks.slice(0, visible);

  const { data: allSessions = [] } = useQuery(
    monthSessionsQuery(username, isoDate(weekDays(firstWeek)[0]), isoDate(weekDays(lastWeek)[6])),
  );

  const sessions = allSessions.filter((s) =>
    onlyDone ? s.status === "done" : s.status !== "skipped",
  );
  const byDay = aggregateByDay(sessions);

  const value = (d: DayVolume) => (metric === "km" ? d.km : d.seconds);
  const max = Math.max(0, ...Array.from(byDay.values(), value));

  const usedForms = new Set<string>();
  let hasMixed = false;
  for (const d of byDay.values()) {
    if (d.forms.size > 1) hasMixed = true;
    else d.forms.forEach((f) => usedForms.add(f));
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard.log.title")}
        </p>
        <ToggleGroup
          type="single"
          value={metric}
          onValueChange={(v) => v && setMetric(v as Metric)}
          className="h-7 gap-0 rounded-full border bg-muted p-0.5"
        >
          {(["km", "hours"] as const).map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              className="h-6 rounded-full px-3 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
            >
              {t(`dashboard.log.${m}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-[minmax(72px,auto)_repeat(7,minmax(0,1fr))] items-center gap-x-1">
        <div />
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <div
            key={d}
            className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t(`weekday.${d}`).slice(0, 3)}
          </div>
        ))}

        {shown.map((week) => {
          const days = weekDays(week).map((d) => isoDate(d));
          const total = days.reduce(
            (acc, d) => {
              const v = byDay.get(d);
              return v ? { seconds: acc.seconds + v.seconds, km: acc.km + v.km } : acc;
            },
            { seconds: 0, km: 0 },
          );
          return (
            <div key={week} className="contents">
              <Link
                to="/u/$username/week/$week"
                params={{ username, week }}
                className="flex h-14 flex-col justify-center border-t pr-2 hover:text-primary"
              >
                <div className="text-xs font-semibold">W{week.split("-W")[1]}</div>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {formatValue(metric, total)}
                </div>
              </Link>
              {days.map((date) => {
                const d = byDay.get(date);
                return (
                  <div key={date} className="flex h-14 items-center justify-center border-t">
                    {d && (
                      <div
                        className="rounded-full transition-all"
                        title={`${date}: ${Array.from(d.forms, (f) => t(`form.${f}`)).join(", ")} · ${formatValue(metric, d)}`}
                        style={{
                          width: bubbleSize(value(d), max),
                          height: bubbleSize(value(d), max),
                          backgroundColor: dayColor(d.forms),
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {visible < weeks.length && (
        <div className="mt-2 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            {t("dashboard.log.showMore")}
          </Button>
        </div>
      )}

      {(usedForms.size > 0 || hasMixed) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {FORMS.filter((f) => usedForms.has(f)).map((f) => (
            <LegendItem key={f} color={FORM_COLORS[f]} label={t(`form.${f}`)} />
          ))}
          {hasMixed && <LegendItem color={MIXED_COLOR} label={t("dashboard.log.mixed")} />}
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
