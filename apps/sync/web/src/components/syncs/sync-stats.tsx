import type { SyncCounts } from "@/lib/api.ts";
import { Panel } from "../ui/panel.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

const STATS: [keyof SyncCounts, string][] = [
  ["refs", "Branches and tags"],
  ["pull", "Pull requests"],
  ["issue", "Issues"],
  ["comment", "Comments"],
  ["review", "Reviews"],
  ["review_comment", "Review comments"],
  ["check_run", "Check runs"],
  ["label", "Labels"],
];

/** What the sync keeps paired: each item here exists on both sides and follows its original. */
export function SyncStats({ counts }: { counts: SyncCounts }) {
  return (
    <Panel as="section">
      <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-medium dark:border-zinc-800">Paired on both sides</h2>
      <dl className="flex flex-col py-1.5">
        {STATS.map(([key, label]) => (
          <div key={key} className="flex items-baseline justify-between px-4 py-1.5 text-[13px]">
            <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
            <dd className={`font-medium tabular-nums ${counts[key] ? "" : "text-zinc-400 dark:text-zinc-600"}`}>{counts[key] ?? 0}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function SyncStatsSkeleton() {
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <Skeleton className="h-4 w-32" />
      {STATS.map(([key]) => (
        <Skeleton key={key} className="h-3.5 w-full" />
      ))}
    </Panel>
  );
}
