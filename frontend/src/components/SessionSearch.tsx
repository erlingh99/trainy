import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionSearchQuery, type SessionSearchFilters } from "@/lib/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FORMS, CHARACTERS, STATUSES, type Session, type SessionStatus } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SessionCard } from "./SessionCard";
import { SessionViewDialog } from "./SessionViewDialog";
import { Pin, Search as SearchIcon, Trophy, X } from "lucide-react";
import confetti from "canvas-confetti";

const ALL = "_all";

type Props = {
  username: string;
  filters: SessionSearchFilters;
  onFiltersChange: (patch: Partial<SessionSearchFilters>) => void;
};

function FilterField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function SessionSearch({ username, filters, onFiltersChange }: Props) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    sessionSearchQuery(username, filters),
  );
  const total = data?.pages[0]?.total ?? null;
  const loadedCount = data?.pages.reduce((n, p) => n + p.items.length, 0) ?? 0;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && fetchNextPage(), {
      rootMargin: "300px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, fetchNextPage]);

  const [text, setText] = useState(filters.q ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushedRef = useRef(filters.q ?? "");

  // Adopt `q` when it changes from outside the input (back/forward, shared URL).
  useEffect(() => {
    const q = filters.q ?? "";
    if (q !== pushedRef.current) {
      pushedRef.current = q;
      setText(q);
    }
  }, [filters.q]);

  useEffect(() => () => clearTimeout(debounceRef.current ?? undefined), []);

  const [viewing, setViewing] = useState<Session | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "short", year: "numeric" }),
    [i18n.language],
  );

  const markDone = useMutation({
    mutationFn: (id: string) =>
      api<Session>(`/api/sessions/${id}`, { method: "PATCH", json: { status: "done" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      confetti({ particleCount: 120, spread: 70, origin: { y: 1 }, angle: 90 });
    },
  });

  const handleTextChange = (v: string) => {
    setText(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushedRef.current = v.trim();
      onFiltersChange({ q: v.trim() || undefined });
    }, 400);
  };

  const hasActiveFilters =
    !!filters.q ||
    !!filters.status ||
    !!filters.form ||
    !!filters.character ||
    filters.competition != null ||
    filters.hasLactate != null ||
    !!filters.from ||
    !!filters.to;

  const clearFilters = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushedRef.current = "";
    setText("");
    onFiltersChange({
      q: undefined,
      status: undefined,
      form: undefined,
      character: undefined,
      competition: undefined,
      hasLactate: undefined,
      from: undefined,
      to: undefined,
    });
  };

  // Newest first, grouped by day so results read like the week overview.
  const days = useMemo(() => {
    const byDate = new Map<string, Session[]>();
    for (const s of data?.pages.flatMap((p) => p.items) ?? []) {
      const list = byDate.get(s.date);
      if (list) list.push(s);
      else byDate.set(s.date, [s]);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(
        ([date, items]) =>
          [date, items.sort((a, b) => a.session_no - b.session_no)] as [string, Session[]],
      );
  }, [data]);

  return (
    <div className="container mx-auto max-w-4xl space-y-4 px-3 py-6">
      <h1 className="text-lg font-semibold text-primary">{t("search.title")}</h1>

      {/* ── Filter bar ─────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={t("search.placeholder")}
            className="pl-8"
          />
        </div>

        <div className="grid grid-cols-1 gap-x-2 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <FilterField id="filter-status" label={t("search.status")}>
            <Select
              value={filters.status ?? ALL}
              onValueChange={(v) =>
                onFiltersChange({ status: v === ALL ? undefined : (v as SessionStatus) })
              }
            >
              <SelectTrigger id="filter-status" className="h-9 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("search.all")}</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField id="filter-form" label={t("search.form")}>
            <Select
              value={filters.form ?? ALL}
              onValueChange={(v) => onFiltersChange({ form: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="filter-form" className="h-9 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("search.all")}</SelectItem>
                {FORMS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`form.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField id="filter-character" label={t("search.character")}>
            <Select
              value={filters.character ?? ALL}
              onValueChange={(v) => onFiltersChange({ character: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="filter-character" className="h-9 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("search.all")}</SelectItem>
                {CHARACTERS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`character.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField id="filter-from" label={t("search.from")}>
            <Input
              id="filter-from"
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => onFiltersChange({ from: e.target.value || undefined })}
              className="h-9 min-w-0"
            />
          </FilterField>

          <FilterField id="filter-to" label={t("search.to")}>
            <Input
              id="filter-to"
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => onFiltersChange({ to: e.target.value || undefined })}
              className="h-9 min-w-0"
            />
          </FilterField>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            variant="outline"
            size="sm"
            pressed={filters.competition === true}
            onPressedChange={(p) => onFiltersChange({ competition: p ? true : undefined })}
            className="gap-1.5 text-xs"
          >
            <Trophy className="h-3.5 w-3.5" />
            {t("search.competitionOnly")}
          </Toggle>
          <Toggle
            variant="outline"
            size="sm"
            pressed={filters.hasLactate === true}
            onPressedChange={(p) => onFiltersChange({ hasLactate: p ? true : undefined })}
            className="gap-1.5 text-xs"
          >
            <Pin className="h-3.5 w-3.5" />
            {t("search.lactateOnly")}
          </Toggle>
          {hasActiveFilters && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto gap-1 text-xs text-muted-foreground"
              onClick={clearFilters}
            >
              <X className="h-3.5 w-3.5" />
              {t("search.clear")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────── */}
      {!isLoading && total != null && (
        <p className="text-xs text-muted-foreground">
          {t("search.resultCount", { count: total })}
          {hasNextPage && (
            <span className="ml-1">{t("search.showingSoFar", { n: loadedCount })}</span>
          )}
        </p>
      )}

      {!isLoading && days.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("search.noResults")}
        </p>
      )}

      <div className="space-y-4">
        {days.map(([date, items]) => {
          const d = new Date(`${date}T00:00:00`);
          const isToday = date === today;
          return (
            <div key={date} className="space-y-1.5">
              <div className="px-1">
                <span className={cn("text-sm font-medium", isToday && "text-primary")}>
                  {t(`weekday.${((d.getDay() + 6) % 7) + 1}`)}
                  <span
                    className={cn(
                      "ml-1.5 text-xs font-normal",
                      isToday ? "text-primary/60" : "text-muted-foreground",
                    )}
                  >
                    {dateFmt.format(d)}
                  </span>
                </span>
              </div>
              {items.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  today={today}
                  t={t}
                  onView={() => setViewing(s)}
                  onMarkDone={() => markDone.mutate(s.id)}
                  markDonePending={markDone.isPending}
                />
              ))}
            </div>
          );
        })}
      </div>

      {hasNextPage && (
        <div ref={sentinelRef}>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? t("api.loading") : t("search.loadMore")}
          </Button>
        </div>
      )}

      {viewing && (
        <SessionViewDialog
          open
          onOpenChange={(o) => !o && setViewing(null)}
          session={viewing}
          userId={viewing.user_id}
          today={today}
          onMarkDone={() => {
            markDone.mutate(viewing.id);
            setViewing(null);
          }}
          markDonePending={markDone.isPending}
        />
      )}
    </div>
  );
}
