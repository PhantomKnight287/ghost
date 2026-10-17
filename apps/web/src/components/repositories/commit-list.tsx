import Link from "next/link";
import type { ComponentProps } from "react";

import { FromNowHoverCard } from "@/components/from-now-card";
import {
  CommitStatusIcon,
  CommitStatusRows,
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
  status: components["schemas"]["CombinedCommitStatusDTO"] | null;
};

/** One row per commit, each linking to `${commitHref}/<sha>`. */
export function CommitList({
  commits,
  commitHref,
  empty,
}: {
  commits: Commit[];
  commitHref: string;
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
          {commit.status && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={statusTitle[commit.status.state]}
                  className="flex shrink-0 items-center"
                >
                  <CommitStatusIcon state={commit.status.state} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="flex w-80 flex-col gap-2">
                <p className="font-medium">
                  {statusTitle[commit.status.state]}
                </p>
                <CommitStatusRows statuses={commit.status.statuses} />
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
