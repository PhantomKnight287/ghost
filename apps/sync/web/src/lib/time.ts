const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "22 Nov 2026, 16:53", for a tooltip beside a relative time. */
export const exactTime = (iso: string) => exact.format(new Date(iso));

/** "3 minutes ago", or "just now" under a minute. */
export function ago(iso: string, now = Date.now()) {
  const elapsed = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) if (Math.abs(elapsed) >= ms) return relative.format(Math.round(elapsed / ms), unit);
  return "just now";
}

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** "Today", "Yesterday", or the date, for grouping a log by day. */
export function dayOf(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dayFormat.format(date);
}
