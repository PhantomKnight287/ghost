import Link from "next/link";
import type { ComponentProps } from "react";

import { FromNowHoverCard } from "@/components/from-now-card";
import {
  CommitCheckRows,
  CommitStatusIcon,
  statusTitle,
} from "@/components/repositories/commit-checks";
import { CommitVerificationBadge } from "@/components/repositories/commit-verification";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { components } from "@/lib/api/v1";

type Commit = {
  sha: string;
  subject: string;
  authorName: string;
  committedAt: string;
  verification: ComponentProps<typeof CommitVerificationBadge>["verification"];
  checks: components["schemas"]["CommitChecksDTO"] | null;
};

/** One row per commit, each linking to `${commitHref}/<sha>`; the tick opens the commit's checks. */
export function CommitList({
  commits,
  commitHref,
  repository,
  empty,
}: {
  commits: Commit[];
  commitHref: string;
  repository: { username: string; repo: string };
  empty: string;
}) {
  if (commits.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">{empty}</p>
    );
  }

  return (
    <ul className="divide-y">
      {commits.map((commit) => (
        <li
          key={commit.sha}
          className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`${commitHref}/${commit.sha}`}
              className="truncate font-medium hover:underline"
            >
              {commit.subject}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {commit.authorName} committed{" "}
              <FromNowHoverCard date={commit.committedAt} />
            </p>
          </div>
          {commit.checks && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={statusTitle[commit.checks.state]}
                  className="flex shrink-0 items-center"
                >
                  <CommitStatusIcon state={commit.checks.state} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto">
                <p className="font-medium">
                  {statusTitle[commit.checks.state]}
                </p>
                <CommitCheckRows
                  checks={commit.checks}
                  repository={repository}
                />
              </PopoverContent>
            </Popover>
          )}
          <CommitVerificationBadge verification={commit.verification} />
          <Link
            href={`${commitHref}/${commit.sha}`}
            className="shrink-0 font-mono text-xs text-muted-foreground hover:underline"
          >
            {commit.sha.slice(0, 7)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
