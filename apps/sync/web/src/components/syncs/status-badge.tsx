import type { SyncStatus } from "@/lib/api.ts";

const LOOK: Record<SyncStatus, { label: string; className: string }> = {
  active: { label: "Healthy", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  backfilling: { label: "Backfilling", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  paused: { label: "Paused", className: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  disconnected: { label: "Disconnected", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  error: { label: "Error", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

export function StatusBadge({ status }: { status: SyncStatus }) {
  const { label, className } = LOOK[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}
