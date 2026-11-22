import { useState } from "react";
import { type Activity, HOST } from "@/lib/api.ts";
import { dayOf, exactTime } from "@/lib/time.ts";
import { Panel } from "../ui/panel.tsx";
import { Segmented } from "../ui/segmented.tsx";

const KIND: Record<string, string> = {
  refs: "Branch",
  issue: "Issue",
  pull: "Pull request",
  comment: "Comment",
  review: "Review",
  review_comment: "Review comment",
  label: "Label",
  check_run: "Check run",
  reconcile: "Sync",
  sync: "Sync",
  job: "Sync",
};

const FILTERS = {
  all: { label: "All", keep: () => true },
  ghost: { label: "To Ghost", keep: (entry: Activity) => entry.direction === "ghost" },
  github: { label: "To GitHub", keep: (entry: Activity) => entry.direction === "github" },
  problems: { label: "Problems", keep: (entry: Activity) => entry.error !== null },
} as const;

type Filter = keyof typeof FILTERS;

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** What synced which way, and what was skipped and why, newest first and grouped by day. */
export function ActivityList({ activity }: { activity: Activity[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const days = new Map<string, Activity[]>();
  for (const entry of activity.filter(FILTERS[filter].keep)) days.set(dayOf(entry.at), [...(days.get(dayOf(entry.at)) ?? []), entry]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Activity</h2>
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={(Object.keys(FILTERS) as Filter[]).map((key) => ({
            value: key,
            label: (
              <>
                {FILTERS[key].label} <span className="ml-0.5 tabular-nums opacity-60">{activity.filter(FILTERS[key].keep).length}</span>
              </>
            ),
          }))}
        />
      </div>
      {days.size === 0 ? (
        <Panel className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {activity.length === 0 ? "Nothing yet. Pushes, copies and anything skipped show up here as they happen." : "Nothing matches this filter."}
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          {[...days].map(([day, entries]) => (
            <div key={day}>
              <h3 className="border-y border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs font-medium text-zinc-500 first:border-t-0 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{day}</h3>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {entries.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex gap-3 px-4 py-3">
                    <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${entry.error ? "bg-red-500" : "bg-emerald-500"}`} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="text-sm break-words">{entry.summary}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {KIND[entry.kind] ?? entry.kind}
                        {entry.direction && ` · to ${HOST[entry.direction]}`}
                      </p>
                      {entry.error && <p className="mt-1 font-mono text-xs break-words text-red-600 dark:text-red-400">{entry.error}</p>}
                    </div>
                    <time dateTime={entry.at} title={exactTime(entry.at)} className="shrink-0 text-xs text-zinc-400 tabular-nums">
                      {clock.format(new Date(entry.at))}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
      )}
    </section>
  );
}
