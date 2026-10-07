import Link from "next/link";
import type { ComponentProps } from "react";

import { FromNowHoverCard } from "@/components/from-now-card";
import { CommitVerificationBadge } from "@/components/repositories/commit-verification";

type Commit = {
  sha: string;
  subject: string;
  authorName: string;
  committedAt: string;
  verification: ComponentProps<typeof CommitVerificationBadge>["verification"];
};

/** One row per commit, each linking to the commit under `commitBase`, the `/owner/repo` its objects live in. */
export function CommitList({
  commits,
  commitBase,
  empty,
}: {
  commits: Commit[];
  commitBase: string;
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
              href={`${commitBase}/commit/${commit.sha}`}
              className="truncate font-medium hover:underline"
            >
              {commit.subject}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {commit.authorName} committed{" "}
              <FromNowHoverCard date={commit.committedAt} />
            </p>
          </div>
          <CommitVerificationBadge verification={commit.verification} />
          <Link
            href={`${commitBase}/commit/${commit.sha}`}
            className="shrink-0 font-mono text-xs text-muted-foreground hover:underline"
          >
            {commit.sha.slice(0, 7)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
