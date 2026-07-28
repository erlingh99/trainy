import { Fragment } from "react";
import {
  sessionDuration,
  sessionDistance,
  sessionMaxLactate,
  FORM_COLORS,
  type Session,
} from "@/lib/types";
import { km, secondsToHmm } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Chip, StatusBadge } from "./SessionViewDialog";
import { Check, Clock, Pin, Route, Trophy } from "lucide-react";

export function LactateIndicator({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5 text-rose-600 dark:text-rose-400">
      <Pin className="h-3 w-3 shrink-0" />
      {value} mmol/L
    </span>
  );
}

export function SessionCard({
  session: s,
  today,
  t,
  onView,
  onMarkDone,
  markDonePending,
}: {
  session: Session;
  today: string;
  t: (key: string) => string;
  onView: () => void;
  onMarkDone: () => void;
  markDonePending: boolean;
}) {
  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm active:bg-accent/60"
      onClick={onView}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 font-medium">
          <span className="truncate">
            {s.name ?? (s.parts[0]?.form ? t(`form.${s.parts[0].form}`) : t("form.other"))}
          </span>
          {s.parts.some((p) => p.competition) && (
            <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {sessionDuration(s) != null && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3 shrink-0" />
              {secondsToHmm(sessionDuration(s))}
            </span>
          )}
          {sessionDistance(s) != null && (
            <span className="flex items-center gap-0.5">
              <Route className="h-3 w-3 shrink-0" />
              {km(sessionDistance(s))}
            </span>
          )}
          {sessionMaxLactate(s) != null && <LactateIndicator value={sessionMaxLactate(s)!} />}
        </div>
        {s.parts.some((p) => p.form || p.character) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {s.parts.map((p, i) => (
              <Fragment key={i}>
                {p.form && (
                  <Chip color={FORM_COLORS[p.form] ?? "#64748b"}>{t(`form.${p.form}`)}</Chip>
                )}
                {p.character && <Chip>{t(`character.${p.character}`)}</Chip>}
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusBadge status={s.status} t={t} />
        {s.status === "planned" && s.date <= today && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
            title={t("session.markDone")}
            onClick={(e) => {
              e.stopPropagation();
              onMarkDone();
            }}
            disabled={markDonePending}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
