import { Fragment, startTransition, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { weekDays, isoDate, shiftIsoWeek, currentIsoWeek, weekRangeLabel } from "@/lib/week";
import { weekSummaryQuery, usersQuery, goalsQuery, garminStatusQuery } from "@/lib/queries";
import { km, secondsToHmm } from "@/lib/format";
import {
  sessionDuration,
  sessionDistance,
  sessionMaxLactate,
  computeTotals,
  FORM_COLORS,
  type Session,
  type WeekSummary,
  type Totals,
  type Goals,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  GripVertical,
  MessageCircle,
  Pin,
  Plus,
  Route,
  Trophy,
  Watch,
} from "lucide-react";
import { SessionDialog } from "./SessionDialog";
import { SessionViewDialog, StatusBadge, Chip } from "./SessionViewDialog";
import { GarminSyncModal } from "./GarminSyncModal";
import { DailyVolumeChart } from "./TrainingCharts";
import { cn } from "@/lib/utils";
import confetti from "canvas-confetti";
import { api } from "@/lib/api";
import { SessionCard, LactateIndicator } from "./SessionCard";

// Strip the layout prefix ("d:" or "m:") from dnd-kit drag IDs to get the real session ID
const toSessionId = (dragId: string | number) => String(dragId).replace(/^[dm]:/, "");

// ── Sortable row (reorder mode only) ──────────────────────────────────────

function SortableSessionRow({
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `d:${s.id}`,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0, scaleX: 1 } : null),
    transition,
    opacity: isDragging ? 0.15 : 1,
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-t hover:bg-accent/40">
      <td className="p-2">
        <button
          className="cursor-grab touch-none rounded p-1 text-muted-foreground/50 hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label={t("session.dragHandle")}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="p-2">
        <div className="flex items-center gap-1">
          <span>{s.name ?? <span className="text-muted-foreground/60">—</span>}</span>
          {s.parts.some((p) => p.competition) && (
            <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
        </div>
        {(s.parts.some((p) => p.form || p.character) || sessionMaxLactate(s) != null) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {s.parts.map((p, i) => (
              <Fragment key={i}>
                {p.form && (
                  <Chip color={FORM_COLORS[p.form] ?? "#64748b"}>{t(`form.${p.form}`)}</Chip>
                )}
                {p.character && <Chip>{t(`character.${p.character}`)}</Chip>}
              </Fragment>
            ))}
            {sessionMaxLactate(s) != null && (
              <span className="text-xs">
                <LactateIndicator value={sessionMaxLactate(s)!} />
              </span>
            )}
          </div>
        )}
      </td>
      <td className="p-2 text-right tabular-nums">{secondsToHmm(sessionDuration(s))}</td>
      <td className="p-2 text-right tabular-nums">{km(sessionDistance(s))}</td>
      <td className="p-2">{s.status && <StatusBadge status={s.status} t={t} />}</td>
      <td className="p-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {s.status === "planned" && s.date <= today && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
              title={t("session.markDone")}
              onClick={onMarkDone}
              disabled={markDonePending}
            >
              <Check className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onView}>
            {t("session.edit")}
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Drag overlay pill ──────────────────────────────────────────────────────

function SessionDragOverlay({ session, t }: { session: Session; t: (key: string) => string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-xl ring-1 ring-border">
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">
        {session.name ??
          (session.parts[0]?.form ? t(`form.${session.parts[0].form}`) : t("form.other"))}
      </span>
      {session.parts.some((p) => p.competition) && (
        <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      {session.parts.some((p) => p.form) && session.name && (
        <span className="text-muted-foreground">
          {session.parts
            .map((p) => (p.form ? t(`form.${p.form}`) : null))
            .filter(Boolean)
            .join(", ")}
        </span>
      )}
      {sessionDuration(session) != null && (
        <span className="tabular-nums text-muted-foreground">
          {secondsToHmm(sessionDuration(session))}
        </span>
      )}
      {sessionDistance(session) != null && (
        <span className="tabular-nums text-muted-foreground">{km(sessionDistance(session))}</span>
      )}
    </div>
  );
}

// ── Droppable day header (cross-day drop target) ──────────────────────────

function DroppableDayHeader({
  iso,
  highlighted,
  isToday,
  children,
}: {
  iso: string;
  highlighted: boolean;
  isToday: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `day::${iso}` });
  return (
    <tr
      ref={setNodeRef}
      className={cn(
        "border-t-2 border-t-border",
        highlighted ? "bg-primary/10" : isToday ? "bg-primary/[0.06]" : "bg-muted/20",
      )}
    >
      {children}
    </tr>
  );
}

// ── Droppable day header (mobile) ─────────────────────────────────────────

function DroppableMobileDayHeader({
  iso,
  highlighted,
  children,
}: {
  iso: string;
  highlighted: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `day::${iso}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center justify-between rounded py-1 px-1 transition-colors",
        highlighted ? "bg-primary/10" : "",
      )}
    >
      {children}
    </div>
  );
}

// ── Sortable mobile card (reorder mode) ───────────────────────────────────

function SortableMobileCard({
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `m:${s.id}`,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0, scaleX: 1 } : null),
    transition,
    opacity: isDragging ? 0.15 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
      <button
        className="touch-none shrink-0 cursor-grab rounded p-1.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground active:cursor-grabbing"
        aria-label={t("session.dragHandle")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <SessionCard
          session={s}
          today={today}
          t={t}
          onView={onView}
          onMarkDone={onMarkDone}
          markDonePending={markDonePending}
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = { username: string; week: string; noContainer?: boolean };

export function WeekGrid({ username, week, noContainer }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: users = [] } = useQuery(usersQuery());
  const user = users.find((u) => u.name === username);
  const { data: summary } = useQuery(weekSummaryQuery(username, week));
  const { data: goals } = useQuery(goalsQuery(username));

  const days = useMemo(() => weekDays(week), [week]);
  const [onlyDone, setOnlyDone] = useState(false);
  const sessions = useMemo(() => summary?.sessions ?? [], [summary?.sessions]);

  const sessionMap = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.session_no - b.session_no);
    return map;
  }, [sessions]);

  const statSessions = useMemo(
    () => (onlyDone ? sessions.filter((s) => s.status === "done") : sessions),
    [sessions, onlyDone],
  );
  const totals = useMemo(() => computeTotals(statSessions), [statSessions]);

  // editing: only for adding new sessions
  const [editing, setEditing] = useState<{ date: string; sessionNo: number } | null>(null);
  // viewing: opens the view dialog for an existing session
  const [viewing, setViewing] = useState<Session | null>(null);
  const [reordering, setReordering] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [highlightedDay, setHighlightedDay] = useState<string | null>(null);
  const [garminSyncOpen, setGarminSyncOpen] = useState(false);

  const { data: garminStatus } = useQuery(garminStatusQuery(username));

  const today = new Date().toISOString().slice(0, 10);
  const openViewing = useCallback((s: Session) => {
    startTransition(() => setViewing(s));
  }, []);
  const openEditing = useCallback((date: string, sessionNo: number) => {
    startTransition(() => setEditing({ date, sessionNo }));
  }, []);
  const qc = useQueryClient();

  const markDone = useMutation({
    mutationFn: (id: string) =>
      api<Session>(`/api/sessions/${id}`, { method: "PATCH", json: { status: "done" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summary", "week"] });
      qc.invalidateQueries({ queryKey: ["summary", "month"] });
      confetti({ particleCount: 120, spread: 70, origin: { y: 1 }, angle: 90 });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setActiveId(toSessionId(active.id));
  }, []);

  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!active || !over) {
        setHighlightedDay(null);
        return;
      }
      const activeSession = sessions.find((s) => s.id === toSessionId(active.id));
      if (!activeSession) {
        setHighlightedDay(null);
        return;
      }
      const overId = String(over.id);
      let targetDate: string;
      if (overId.startsWith("day::")) {
        targetDate = overId.slice(5);
      } else {
        const overSession = sessions.find((s) => s.id === toSessionId(overId));
        if (!overSession) {
          setHighlightedDay(null);
          return;
        }
        targetDate = overSession.date;
      }
      setHighlightedDay(targetDate !== activeSession.date ? targetDate : null);
    },
    [sessions],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveId(null);
      setHighlightedDay(null);
      if (!over || active.id === over.id) return;

      const activeSession = sessions.find((s) => s.id === toSessionId(active.id));
      if (!activeSession) return;

      const overId = String(over.id);
      let targetDate: string;
      let overSession: Session | undefined;

      if (overId.startsWith("day::")) {
        targetDate = overId.slice(5);
      } else {
        overSession = sessions.find((s) => s.id === toSessionId(overId));
        if (!overSession) return;
        targetDate = overSession.date;
      }

      const sourceDate = activeSession.date;

      if (sourceDate === targetDate && overSession) {
        // Same-day reorder
        const ofDay = sessionMap.get(sourceDate) ?? [];
        const oldIdx = ofDay.findIndex((s) => s.id === toSessionId(active.id));
        const newIdx = ofDay.findIndex((s) => s.id === toSessionId(over.id));
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reordered = arrayMove(ofDay, oldIdx, newIdx);

        qc.setQueryData(
          ["summary", "week", username, week],
          (old: WeekSummary | undefined): WeekSummary | undefined => {
            if (!old) return old;
            const noMap = new Map(reordered.map((s, i) => [s.id, i + 1]));
            return {
              ...old,
              sessions: old.sessions.map((s) =>
                noMap.has(s.id) ? { ...s, session_no: noMap.get(s.id)! } : s,
              ),
            };
          },
        );

        api("/api/sessions/reorder", {
          method: "POST",
          json: { ids: reordered.map((s) => s.id) },
        }).catch(() => qc.invalidateQueries({ queryKey: ["summary", "week"] }));
      } else {
        // Cross-day move (or drop on day header)
        const sourceDay = sessionMap.get(sourceDate) ?? [];
        const targetDay = (sessionMap.get(targetDate) ?? []).filter(
          (s) => s.id !== activeSession.id,
        );

        // Determine insertion index in the target day
        let insertIdx: number;
        if (overSession) {
          insertIdx = targetDay.findIndex((s) => s.id === toSessionId(over.id));
          if (insertIdx === -1) insertIdx = targetDay.length;
        } else {
          insertIdx = targetDay.length; // drop on day header → append
        }

        const newSourceDay = sourceDay.filter((s) => s.id !== activeSession.id);
        const newTargetDay = [...targetDay];
        newTargetDay.splice(insertIdx, 0, { ...activeSession, date: targetDate });

        // Optimistic cache update
        qc.setQueryData(
          ["summary", "week", username, week],
          (old: WeekSummary | undefined): WeekSummary | undefined => {
            if (!old) return old;
            const updates = new Map<string, { date: string; session_no: number }>();
            newSourceDay.forEach((s, i) => updates.set(s.id, { date: s.date, session_no: i + 1 }));
            newTargetDay.forEach((s, i) =>
              updates.set(s.id, { date: targetDate, session_no: i + 1 }),
            );
            return {
              ...old,
              sessions: old.sessions.map((s) => {
                const u = updates.get(s.id);
                return u ? { ...s, ...u } : s;
              }),
            };
          },
        );

        // Patch date first (if changed), then reorder both days
        (async () => {
          try {
            if (sourceDate !== targetDate) {
              await api(`/api/sessions/${activeSession.id}`, {
                method: "PATCH",
                json: { date: targetDate },
              });
            }
            const reorderOps = [
              api("/api/sessions/reorder", {
                method: "POST",
                json: { ids: newTargetDay.map((s) => s.id) },
              }),
            ];
            if (newSourceDay.length > 0) {
              reorderOps.push(
                api("/api/sessions/reorder", {
                  method: "POST",
                  json: { ids: newSourceDay.map((s) => s.id) },
                }),
              );
            }
            await Promise.all(reorderOps);
          } catch {
            qc.invalidateQueries({ queryKey: ["summary", "week"] });
          }
        })();
      }
    },
    [sessions, sessionMap, username, week, qc],
  );

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "short" }),
    [i18n.language],
  );
  const activeSession = activeId ? (sessions.find((s) => s.id === activeId) ?? null) : null;

  const goWeek = (delta: number) => {
    startTransition(() => {
      navigate({
        to: "/u/$username/week/$week",
        params: { username, week: shiftIsoWeek(week, delta) },
      });
    });
  };

  if (!user) {
    return <div className="container mx-auto p-4 text-muted-foreground">User not found.</div>;
  }

  return (
    <div className={noContainer ? "p-3" : "container mx-auto p-3"}>
      {!noContainer && (
        <div className="flex flex-wrap items-center gap-y-2 gap-x-1 pb-3">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
            onClick={() => goWeek(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[130px] whitespace-nowrap text-center text-sm font-semibold text-primary">
            {weekRangeLabel(week, i18n.language)}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
            onClick={() => goWeek(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() =>
              startTransition(() =>
                navigate({
                  to: "/u/$username/week/$week",
                  params: { username, week: currentIsoWeek() },
                }),
              )
            }
          >
            {t("nav.today")}
          </Button>
          {garminStatus?.connected && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Sync this week from Garmin"
              onClick={() => setGarminSyncOpen(true)}
            >
              <Watch className="h-4 w-4" />
            </Button>
          )}
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
      )}
      {goals &&
        (goals.sessions_per_week > 0 || goals.hours_per_week > 0 || goals.km_per_week > 0) && (
          <WeekGoals goals={goals} totals={totals} t={t} />
        )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* ── Desktop table (md+) ─────────────────────────────────────── */}
        <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-primary/15 bg-primary/[0.04] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2 text-left">
                  {t("nav.week")} {week.split("-W")[1]}
                </th>
                <th className="p-2 text-left">{reordering ? "" : t("session.no")}</th>
                <th className="p-2 text-left">{t("session.name")}</th>
                <th className="p-2 text-right">{t("session.duration")}</th>
                <th className="p-2 text-right">{t("session.distance")}</th>
                <th className="p-2 text-left">{t("session.status")}</th>
                <th className="p-2 text-right">
                  <Button
                    size="sm"
                    variant={reordering ? "default" : "ghost"}
                    className="h-6 gap-1 text-xs"
                    title={t("session.reorder")}
                    onClick={() => setReordering((r) => !r)}
                  >
                    {reordering ? (
                      t("session.doneReorder")
                    ) : (
                      <GripVertical className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {reordering
                ? days.map((d) => {
                    const iso = isoDate(d);
                    const isToday = iso === today;
                    const ofDay = sessionMap.get(iso) ?? [];
                    const nextNo =
                      ofDay.length > 0 ? Math.max(...ofDay.map((s) => s.session_no)) + 1 : 1;
                    const weekdayNum = ((d.getUTCDay() + 6) % 7) + 1;
                    return (
                      <Fragment key={iso}>
                        <DroppableDayHeader
                          iso={iso}
                          highlighted={highlightedDay === iso}
                          isToday={isToday}
                        >
                          <td colSpan={7} className="px-3 py-1.5 text-sm font-medium">
                            <span className={cn(isToday && "text-primary")}>
                              {t(`weekday.${weekdayNum}`)}
                            </span>
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {dateFmt.format(d)}
                            </span>
                          </td>
                        </DroppableDayHeader>
                        <SortableContext
                          items={ofDay.map((s) => `d:${s.id}`)}
                          strategy={verticalListSortingStrategy}
                        >
                          {ofDay.map((s) => (
                            <SortableSessionRow
                              key={s.id}
                              session={s}
                              today={today}
                              t={t}
                              onView={() => openViewing(s)}
                              onMarkDone={() => markDone.mutate(s.id)}
                              markDonePending={markDone.isPending}
                            />
                          ))}
                        </SortableContext>
                        <tr
                          className={cn(
                            "border-t hover:bg-accent/40",
                            isToday && "bg-primary/[0.035]",
                          )}
                        >
                          <td colSpan={7} className="p-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 text-primary/40 hover:bg-primary/10 hover:text-primary"
                              onClick={() => openEditing(iso, nextNo)}
                            >
                              <Plus className="h-3 w-3" />
                              {t("session.add")}
                            </Button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })
                : null}
              {!reordering &&
                days.map((d) => {
                  const iso = isoDate(d);
                  const isToday = iso === today;
                  const ofDay = sessionMap.get(iso) ?? [];
                  const nextNo =
                    ofDay.length > 0 ? Math.max(...ofDay.map((s) => s.session_no)) + 1 : 1;
                  const weekdayNum = ((d.getUTCDay() + 6) % 7) + 1;

                  const totalRows = ofDay.length + 1;
                  const dayCell = (
                    <td
                      rowSpan={totalRows}
                      className={cn("py-2 pl-3 pr-2 align-top", isToday && "text-primary")}
                      style={{
                        borderLeft: isToday ? "3px solid var(--primary)" : "3px solid transparent",
                      }}
                    >
                      <div className="text-sm font-semibold leading-tight">
                        {t(`weekday.${weekdayNum}`)}
                      </div>
                      <div
                        className={cn(
                          "text-[11px]",
                          isToday ? "text-primary/60" : "text-muted-foreground",
                        )}
                      >
                        {dateFmt.format(d)}
                      </div>
                    </td>
                  );

                  return (
                    <Fragment key={iso}>
                      {ofDay.map((s, idx) => (
                        <tr
                          key={s.id}
                          className={cn(
                            "border-t hover:bg-accent/40",
                            idx === 0 ? "border-t-2 border-t-primary/15" : "border-t-primary/10",
                            isToday && "bg-primary/[0.035]",
                          )}
                        >
                          {idx === 0 && dayCell}
                          <td className="p-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary tabular-nums">
                              {s.session_no}
                            </span>
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-1">
                              <span>
                                {s.name ?? <span className="text-muted-foreground/60">—</span>}
                              </span>
                              {s.parts.some((p) => p.competition) && (
                                <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                              )}
                            </div>
                            {(s.parts.some((p) => p.form || p.character) ||
                              sessionMaxLactate(s) != null) && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {s.parts.map((p, i) => (
                                  <Fragment key={i}>
                                    {p.form && (
                                      <Chip color={FORM_COLORS[p.form] ?? "#64748b"}>
                                        {t(`form.${p.form}`)}
                                      </Chip>
                                    )}
                                    {p.character && <Chip>{t(`character.${p.character}`)}</Chip>}
                                  </Fragment>
                                ))}
                                {sessionMaxLactate(s) != null && (
                                  <span className="text-xs">
                                    <LactateIndicator value={sessionMaxLactate(s)!} />
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {secondsToHmm(sessionDuration(s))}
                          </td>
                          <td className="p-2 text-right tabular-nums">{km(sessionDistance(s))}</td>
                          <td className="p-2">
                            {s.status && <StatusBadge status={s.status} t={t} />}
                          </td>
                          <td className="p-2 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              {s.comment && (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                      title={t("session.comment")}
                                    >
                                      <MessageCircle className="h-4 w-4" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="max-w-xs text-sm leading-relaxed"
                                    side="left"
                                    align="center"
                                  >
                                    {s.comment}
                                  </PopoverContent>
                                </Popover>
                              )}
                              {s.status === "planned" && s.date <= today && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                                  title={t("session.markDone")}
                                  onClick={() => markDone.mutate(s.id)}
                                  disabled={markDone.isPending}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                title={t("session.view")}
                                onClick={() => openViewing(s)}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr
                        className={cn(
                          "border-t hover:bg-accent/40",
                          ofDay.length === 0 && "border-t-2 border-t-primary/15",
                          isToday && "bg-primary/[0.035]",
                        )}
                      >
                        {ofDay.length === 0 && dayCell}
                        <td colSpan={6} className="p-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-primary/40 hover:bg-primary/10 hover:text-primary"
                            onClick={() => openEditing(iso, nextNo)}
                          >
                            <Plus className="h-3 w-3" />
                            {t("session.add")}
                          </Button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
            </tbody>
            <tfoot className="border-t-2 border-t-primary/20 bg-primary/10 font-medium">
              <tr>
                <td className="p-2 text-primary" colSpan={3}>
                  {t("summary.weekTotal")}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {secondsToHmm(totals.total_seconds)}
                </td>
                <td className="p-2 text-right tabular-nums">{km(totals.total_distance_km)}</td>
                <td className="p-2 text-xs text-muted-foreground" colSpan={2}>
                  {totals.session_count} {t("summary.sessions").toLowerCase()} ·{" "}
                  {totals.quality_sessions} {t("summary.quality").toLowerCase()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── Mobile card layout (below md) ───────────────────────────── */}
        <div className="space-y-3 md:hidden">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-sm font-semibold text-primary">
              {t("nav.week")} {week.split("-W")[1]}
            </span>
            <Button
              size="sm"
              variant={reordering ? "default" : "ghost"}
              className="h-7 gap-1 text-xs"
              onClick={() => setReordering((r) => !r)}
            >
              {reordering ? t("session.doneReorder") : <GripVertical className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {days.map((d) => {
            const iso = isoDate(d);
            const isToday = iso === today;
            const ofDay = sessionMap.get(iso) ?? [];
            const nextNo = ofDay.length > 0 ? Math.max(...ofDay.map((s) => s.session_no)) + 1 : 1;
            const weekdayNum = ((d.getUTCDay() + 6) % 7) + 1;

            const dayHeader = (
              <>
                <span className={cn("text-sm font-medium", isToday && "text-primary")}>
                  {t(`weekday.${weekdayNum}`)}
                  <span
                    className={cn(
                      "ml-1.5 text-xs font-normal",
                      isToday ? "text-primary/60" : "text-muted-foreground",
                    )}
                  >
                    {dateFmt.format(d)}
                  </span>
                </span>
                {!reordering && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-primary/40 hover:bg-primary/10 hover:text-primary"
                    title={t("session.add")}
                    onClick={() => openEditing(iso, nextNo)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </>
            );

            return (
              <div key={iso}>
                {reordering ? (
                  <DroppableMobileDayHeader iso={iso} highlighted={highlightedDay === iso}>
                    {dayHeader}
                  </DroppableMobileDayHeader>
                ) : (
                  <div
                    className={cn(
                      "flex items-center justify-between rounded py-1 px-1",
                      isToday && "bg-primary/[0.04]",
                    )}
                  >
                    {dayHeader}
                  </div>
                )}
                <SortableContext
                  items={ofDay.map((s) => `m:${s.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {ofDay.map((s) =>
                      reordering ? (
                        <SortableMobileCard
                          key={s.id}
                          session={s}
                          today={today}
                          t={t}
                          onView={() => openViewing(s)}
                          onMarkDone={() => markDone.mutate(s.id)}
                          markDonePending={markDone.isPending}
                        />
                      ) : (
                        <SessionCard
                          key={s.id}
                          session={s}
                          today={today}
                          t={t}
                          onView={() => openViewing(s)}
                          onMarkDone={() => markDone.mutate(s.id)}
                          markDonePending={markDone.isPending}
                        />
                      ),
                    )}
                    {ofDay.length === 0 && (
                      <p className="py-0.5 pl-1 text-xs text-muted-foreground/60">
                        {t("session.empty")}
                      </p>
                    )}
                  </div>
                </SortableContext>
              </div>
            );
          })}
          <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium">
            <span className="text-primary">{t("summary.weekTotal")}</span>
            <div className="flex gap-3 tabular-nums text-muted-foreground">
              <span>{secondsToHmm(totals.total_seconds)}</span>
              <span>{km(totals.total_distance_km)}</span>
              <span>
                {totals.session_count} {t("summary.sessions").toLowerCase()}
              </span>
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
          {activeSession && <SessionDragOverlay session={activeSession} t={t} />}
        </DragOverlay>
      </DndContext>

      <DailyVolumeChart sessions={statSessions} days={days} />

      {editing && user && (
        <SessionDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          userId={user.id}
          date={editing.date}
          sessionNo={editing.sessionNo}
          existing={null}
        />
      )}

      {viewing && user && (
        <SessionViewDialog
          open
          onOpenChange={(o) => !o && setViewing(null)}
          session={viewing}
          userId={user.id}
          today={today}
          onMarkDone={() => {
            markDone.mutate(viewing.id);
            setViewing(null);
          }}
          markDonePending={markDone.isPending}
        />
      )}

      {garminSyncOpen && summary && (
        <GarminSyncModal
          username={username}
          startDate={summary.start}
          endDate={summary.end}
          autoCreate={false}
          onClose={() => setGarminSyncOpen(false)}
          onComplete={() => {
            setGarminSyncOpen(false);
            qc.invalidateQueries({ queryKey: ["summary", "week"] });
            qc.invalidateQueries({ queryKey: ["summary", "month"] });
          }}
        />
      )}
    </div>
  );
}

function WeekGoals({
  goals,
  totals,
  t,
}: {
  goals: Goals;
  totals: Totals;
  t: (key: string) => string;
}) {
  const rows: { label: string; target: number; actual: number; unit: string }[] = [];
  if (goals.sessions_per_week > 0)
    rows.push({
      label: t("dashboard.goals.sessionsPerWeek"),
      target: goals.sessions_per_week,
      actual: totals.session_count,
      unit: "",
    });
  if (goals.hours_per_week > 0)
    rows.push({
      label: t("dashboard.goals.hoursPerWeek"),
      target: goals.hours_per_week,
      actual: Math.round((totals.total_seconds / 3600) * 10) / 10,
      unit: "h",
    });
  if (goals.km_per_week > 0)
    rows.push({
      label: t("dashboard.goals.kmPerWeek"),
      target: goals.km_per_week,
      actual: totals.total_distance_km,
      unit: " km",
    });

  return (
    <div className="mt-1 mb-4 rounded-lg border bg-card p-3">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("dashboard.goals.title")}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map(({ label, target, actual, unit }) => {
          const pct = Math.min(100, Math.round((actual / target) * 100));
          const done = actual >= target;
          return (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    done && "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {Math.round(actual * 10) / 10}
                  {unit} / {target}
                  {unit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    done ? "bg-emerald-500" : "bg-primary",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
