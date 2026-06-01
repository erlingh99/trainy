import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { garminSyncPreview, garminSyncApply } from "@/lib/queries";
import type { ActivityProposal, GarminSyncResult } from "@/lib/types";
import { secondsToHmm, km } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CheckCircle, CircleDot, HelpCircle, Loader2 } from "lucide-react";

type Props = {
  username: string;
  startDate: string;
  endDate: string;
  autoCreate?: boolean;
  onClose: () => void;
  onComplete: (result: GarminSyncResult) => void;
};

type ItemState = {
  proposal: ActivityProposal;
  checked: boolean;
  action: "match" | "create" | "skip";
  session_id: string | null;
};

type Phase = "loading" | "review" | "applying" | "done" | "error";

// Returns the Monday of the ISO week containing dateStr (YYYY-MM-DD)
function weekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

function formatWeekRange(mondayStr: string): string {
  const start = new Date(mondayStr + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function GarminSyncModal({
  username,
  startDate,
  endDate,
  autoCreate = false,
  onClose,
  onComplete,
}: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ItemState[]>([]);
  const [result, setResult] = useState<GarminSyncResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    garminSyncPreview(username, startDate, endDate)
      .then((proposals) => {
        setItems(
          proposals.map((p) => {
            const forceSkip = !autoCreate && p.match_status === "unmatched";
            const action: "match" | "create" | "skip" = forceSkip
              ? "skip"
              : p.proposed_action === "skip"
                ? "skip"
                : p.proposed_action;
            return {
              proposal: p,
              checked: action !== "skip",
              action,
              session_id: p.matched_session_id,
            };
          }),
        );
        setPhase("review");
      })
      .catch((e) => {
        setErrorMsg(e instanceof ApiError ? e.message : String(e));
        setPhase("error");
      });
  }, [username, startDate, endDate, autoCreate]);

  // Group items by week, preserving global indices
  const groupedItems = useMemo(() => {
    const groups = new Map<string, { item: ItemState; idx: number }[]>();
    items.forEach((item, idx) => {
      const week = weekMonday(item.proposal.date);
      if (!groups.has(week)) groups.set(week, []);
      groups.get(week)!.push({ item, idx });
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const toggleItem = (idx: number) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const isActive = it.action !== "skip";
        if (isActive) return { ...it, checked: false, action: "skip" };
        const action: "match" | "create" | "skip" =
          it.proposal.proposed_action !== "skip" ? it.proposal.proposed_action : "create";
        return { ...it, checked: true, action };
      }),
    );
  };

  const toggleWeek = (indices: number[]) => {
    const allChecked = indices.every((i) => items[i].action !== "skip");
    setItems((prev) =>
      prev.map((it, i) => {
        if (!indices.includes(i)) return it;
        if (allChecked) return { ...it, checked: false, action: "skip" };
        const action: "match" | "create" | "skip" =
          it.proposal.proposed_action !== "skip" ? it.proposal.proposed_action : "create";
        return { ...it, checked: true, action };
      }),
    );
  };

  const setItemAction = (idx: number, action: "match" | "create" | "skip") => {
    setItems((prev) =>
      prev.map((it, i) => (i !== idx ? it : { ...it, action, checked: action !== "skip" })),
    );
  };

  const setItemSession = (idx: number, session_id: string) => {
    setItems((prev) =>
      prev.map((it, i) => (i !== idx ? it : { ...it, session_id, action: "match" })),
    );
  };

  const apply = async () => {
    setPhase("applying");
    const payload = items.map((it) => ({
      garmin_activity_id: it.proposal.garmin_activity_id,
      date: it.proposal.date,
      form: it.proposal.form,
      duration_seconds: it.proposal.duration_seconds,
      distance_km: it.proposal.distance_km,
      activity_name: it.proposal.activity_name,
      action: it.action,
      session_id: it.action === "match" ? (it.session_id ?? undefined) : undefined,
    }));

    try {
      const res = await garminSyncApply(username, payload);
      setResult(res);
      setPhase("done");
      onComplete(res);
    } catch (e) {
      setErrorMsg(e instanceof ApiError ? e.message : String(e));
      setPhase("error");
    }
  };

  const selectedCount = items.filter((it) => it.action !== "skip").length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("garmin.importTitle", { start: startDate, end: endDate })}</DialogTitle>
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("garmin.fetching")}
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-destructive">{errorMsg}</p>
            <Button variant="outline" onClick={onClose}>
              {t("garmin.close")}
            </Button>
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-3 py-4">
            <p className="text-sm">
              {t("garmin.importResult", {
                count: result.matched,
                matched: result.matched,
                created: result.created,
                skipped: result.skipped,
              })}
            </p>
            {result.errors.length > 0 && (
              <ul className="space-y-1 text-xs text-destructive">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(phase === "review" || phase === "applying") && (
          <>
            {items.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("garmin.noActivities")}
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
                {groupedItems.map(([weekKey, entries]) => {
                  const indices = entries.map((e) => e.idx);
                  const checkedCount = indices.filter((i) => items[i].action !== "skip").length;
                  return (
                    <div key={weekKey}>
                      <WeekHeader
                        label={formatWeekRange(weekKey)}
                        checkedCount={checkedCount}
                        total={entries.length}
                        onToggle={() => toggleWeek(indices)}
                      />
                      <div className="space-y-1 mt-1">
                        {entries.map(({ item, idx }) => (
                          <ActivityRow
                            key={item.proposal.garmin_activity_id}
                            item={item}
                            onToggle={() => toggleItem(idx)}
                            onActionChange={(action) => setItemAction(idx, action)}
                            onSessionChange={(sid) => setItemSession(idx, sid)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <DialogFooter>
          {phase === "review" && (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("session.cancel")}
              </Button>
              <Button disabled={selectedCount === 0} onClick={apply}>
                {selectedCount > 0
                  ? t("garmin.importButton", { count: selectedCount })
                  : t("garmin.importNoSelection")}
              </Button>
            </>
          )}
          {phase === "applying" && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("garmin.importing")}
            </Button>
          )}
          {phase === "done" && <Button onClick={onClose}>{t("garmin.done")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Week header with select-all checkbox ─────────────────────────────────────

function WeekHeader({
  label,
  checkedCount,
  total,
  onToggle,
}: {
  label: string;
  checkedCount: number;
  total: number;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const allChecked = checkedCount === total;
  const someChecked = checkedCount > 0 && !allChecked;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someChecked;
  }, [someChecked]);

  return (
    <label className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-muted-foreground cursor-pointer select-none">
      <input
        ref={ref}
        type="checkbox"
        checked={allChecked}
        onChange={onToggle}
        className="h-3.5 w-3.5 shrink-0"
      />
      {label}
      <span className="ml-auto font-normal">
        {checkedCount}/{total}
      </span>
    </label>
  );
}

// ── Activity row ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ActivityProposal["match_status"] }) {
  if (status === "matched")
    return <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  if (status === "ambiguous") return <HelpCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <CircleDot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function ActivityRow({
  item,
  onToggle,
  onActionChange,
  onSessionChange,
}: {
  item: ItemState;
  onToggle: () => void;
  onActionChange: (action: "match" | "create" | "skip") => void;
  onSessionChange: (sid: string) => void;
}) {
  const { t } = useTranslation();
  const p = item.proposal;
  const isChecked = item.action !== "skip";

  const rowClass = cn(
    "flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors",
    p.match_status === "matched" && isChecked && "border-emerald-200 bg-emerald-50/50",
    p.match_status === "ambiguous" && "border-amber-200 bg-amber-50/50",
    p.match_status === "unmatched" && isChecked && "border-border bg-muted/30",
    !isChecked && "opacity-50",
  );

  return (
    <div className={rowClass}>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onToggle}
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
      />
      <StatusIcon status={p.match_status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium truncate">{p.activity_name || p.form || "Activity"}</span>
          <span className="text-muted-foreground">{p.date}</span>
        </div>
        <div className="mt-0.5 flex gap-2 text-muted-foreground">
          {p.duration_seconds > 0 && <span>{secondsToHmm(p.duration_seconds)}</span>}
          {p.distance_km != null && <span>{km(p.distance_km)}</span>}
          {p.form && <span className="capitalize">{p.form}</span>}
        </div>

        {p.match_status === "matched" && isChecked && (
          <p className="mt-0.5 text-[10px] text-emerald-700">{t("garmin.updatesSession")}</p>
        )}

        {p.match_status === "ambiguous" && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-amber-700">{t("garmin.matchTo")}</span>
            <Select
              value={item.session_id ?? "__create"}
              onValueChange={(v) => {
                if (v === "__create") onActionChange("create");
                else if (v === "__skip") onActionChange("skip");
                else onSessionChange(v);
              }}
            >
              <SelectTrigger className="h-6 text-[10px] w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {p.candidate_sessions.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name ?? `Session (${c.parts[0]?.form ?? "?"})`}
                  </SelectItem>
                ))}
                <SelectItem value="__create" className="text-xs">
                  {t("garmin.createNew")}
                </SelectItem>
                <SelectItem value="__skip" className="text-xs text-muted-foreground">
                  {t("garmin.skip")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {p.match_status === "unmatched" && isChecked && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t("garmin.willCreate")}</p>
        )}
      </div>
    </div>
  );
}
