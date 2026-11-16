import type { Activity } from "@/lib/api.ts";
import { ago } from "@/lib/time.ts";

const DIRECTION = { ghost: "→ Ghost", github: "→ GitHub" } as const;

/** What synced which way, and what was skipped and why, newest first. */
export function ActivityList({ activity }: { activity: Activity[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Recent activity</h2>
      {activity.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {activity.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-3">
              <span className="shrink-0 text-neutral-500 sm:w-28">{ago(entry.at)}</span>
              <span className="shrink-0 text-neutral-500 sm:w-20">{entry.direction ? DIRECTION[entry.direction] : entry.kind}</span>
              <span className="min-w-0 flex-1">
                {entry.summary}
                {entry.error && <span className="block text-red-600 sm:inline sm:pl-2">{entry.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
