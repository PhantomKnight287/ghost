"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import type { components } from "@/lib/api/v1";

type Contributions = components["schemas"]["GetUserContributionsResponseDTO"];

function level(count: number, max: number) {
  if (count === 0) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

const FILL = [
  "bg-muted",
  "bg-emerald-200 dark:bg-emerald-950",
  "bg-emerald-300 dark:bg-emerald-800",
  "bg-emerald-500 dark:bg-emerald-600",
  "bg-emerald-700 dark:bg-emerald-400",
];

function formatDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ContributionGraph({ data }: { data: Contributions }) {
  const max = data.days.reduce((m, d) => Math.max(m, d.count), 0);

  // Monday-first columns like GitHub: pad the first week so Jan 1 lands on its weekday row (getUTCDay 0=Sunday..6=Saturday).
  const first = data.days[0];
  const pad = first
    ? (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7
    : 0;

  const cells: ({ date: string; count: number } | null)[] = [
    ...Array<null>(pad).fill(null),
    ...data.days,
  ];
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <div>

        <h2 className="text-sm font-semibold">
          Contributions
        </h2>
          <span className="font-normal text-muted-foreground tabular-nums">
            {data.totalContributions} in {data.year}
          </span>

        </div>
        <div className="overflow-x-auto rounded-lg border p-3">
          <div className="flex w-max gap-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((day, di) =>
                  day === null ? (
                    <span key={di} className="size-2.5 rounded-[3px]" />
                  ) : (
                    <Tooltip key={day.date}>
                      <TooltipTrigger asChild>
                        <span
                          className={`size-2.5 rounded-[3px] ${FILL[level(day.count, max)]}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {day.count === 0
                          ? `No contributions on ${formatDay(day.date)}`
                          : `${day.count} contribution${day.count === 1 ? "" : "s"} on ${formatDay(day.date)}`}
                      </TooltipContent>
                    </Tooltip>
                  ),
                )}
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-end gap-1 text-xs text-muted-foreground">
            Less
            {FILL.map((fill, i) => (
              <span key={i} className={`size-2.5 rounded-[3px] ${fill}`} />
            ))}
            More
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Commits to {data.username}&apos;s repositories, counted by commit
          email.
        </p>
      </div>
    </TooltipProvider>
  );
}

export function ContributionGraphSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}
