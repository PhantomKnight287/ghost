import { GitCommitHorizontal } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { FromNowHoverCard } from "@/components/from-now-card";
import { CommitVerificationBadge } from "@/components/repositories/commit-verification";
import type { components } from "@/lib/api/v1";

export function CommitHeader({
  commit,
  browseHref,
  children,
}: {
  commit: components["schemas"]["GetRepositoryCommitResponseDTO"];
  browseHref: string;
  /** Shown at the right of the title row. */
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
        <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{commit.subject}</span>
        <CommitVerificationBadge verification={commit.verification} />
        <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          {children}
          <Link href={browseHref} className="hover:underline">
            Browse files at {commit.sha.slice(0, 7)}
          </Link>
        </div>
      </div>

      <div className="px-4 py-2.5 text-xs text-muted-foreground">
        {commit.authorName} committed{" "}
        <FromNowHoverCard date={commit.committedAt} />
        {" · "}
        {commit.files.length} changed file
        {commit.files.length === 1 ? "" : "s"}
      </div>

      {commit.body && (
        <pre className="border-t px-4 py-2.5 text-xs whitespace-pre-wrap">
          {commit.body}
        </pre>
      )}
    </div>
  );
}
