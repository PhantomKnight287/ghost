const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 minutes ago", or "just now" under a minute. */
export function ago(iso: string, now = Date.now()) {
  const elapsed = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) if (Math.abs(elapsed) >= ms) return relative.format(Math.round(elapsed / ms), unit);
  return "just now";
}
