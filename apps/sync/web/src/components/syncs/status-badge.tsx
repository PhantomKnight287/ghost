import type { SyncStatus } from "@/lib/api.ts";

const LOOK: Record<SyncStatus, { label: string; dot: string }> = {
  active: { label: "Healthy", dot: "bg-emerald-500" },
  backfilling: { label: "First sync running", dot: "bg-sky-500 animate-pulse" },
  paused: { label: "Paused", dot: "bg-zinc-400" },
  disconnected: { label: "Disconnected", dot: "bg-amber-500" },
  error: { label: "Error", dot: "bg-red-500" },
};

export function StatusBadge({ status }: { status: SyncStatus }) {
  const { label, dot } = LOOK[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-300">
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
