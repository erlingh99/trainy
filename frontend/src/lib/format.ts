export function secondsToHmm(s: number | null | undefined): string {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function hmmToSeconds(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  const n = Number(t);
  if (Number.isFinite(n)) return Math.round(n * 60); // bare number = minutes
  return null;
}

export function km(n: number | null | undefined): string {
  if (n == null) return "";
  return n.toFixed(1);
}
