// ISO week helpers. Monday is day 1.

export function isoWeekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function currentIsoWeek(): string {
  return isoWeekOf(new Date());
}

export function parseIsoWeek(s: string): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), week: Number(m[2]) };
}

export function isoWeekRange(s: string): { start: Date; end: Date } {
  const parsed = parseIsoWeek(s);
  if (!parsed) {
    const start = new Date();
    return { start, end: start };
  }
  const { year, week } = parsed;
  // Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const start = new Date(week1Mon);
  start.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start, end };
}

export function shiftIsoWeek(s: string, delta: number): string {
  const { start } = isoWeekRange(s);
  start.setUTCDate(start.getUTCDate() + delta * 7);
  return isoWeekOf(start);
}

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function weekDays(isoWeek: string): Date[] {
  const { start } = isoWeekRange(isoWeek);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d;
  });
}

export function currentYyyyMm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function weekRangeLabel(isoWeek: string, locale: string): string {
  const { start, end } = isoWeekRange(isoWeek);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export function shiftYyyyMm(s: string, delta: number): string {
  const [y, m] = s.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
