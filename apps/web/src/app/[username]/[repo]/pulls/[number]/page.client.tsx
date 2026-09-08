"use client";

import { GitMerge } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  closePullRequest,
  mergePullRequest,
} from "@/components/pull-requests/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function PullRequestNav({
  base,
  commitCount,
  changedFiles,
}: {
  base: string;
  commitCount: number;
  changedFiles: number;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: base, label: "Overview", count: null },
    { href: `${base}/commits`, label: "Commits", count: commitCount },
    { href: `${base}/files`, label: "Files changed", count: changedFiles },
  ];

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            pathname === tab.href
              ? "border-primary font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== null && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function MergePanel({
  username,
  repo,
  number,
  state,
  mergeable,
  canMerge,
  isAuthor,
  mergeCommitSha,
}: {
  username: string;
  repo: string;
  number: number;
  state: string;
  mergeable: boolean;
  canMerge: boolean;
  isAuthor: boolean;
  mergeCommitSha: string | null;
}) {
  const router = useRouter();

  const merge = useAction(mergePullRequest, {
    onSuccess: () => {
      toast.success("Pull request merged.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not merge this pull request."),
  });

  const close = useAction(closePullRequest, {
    onSuccess: () => {
      toast.success("Pull request closed.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not close this pull request."),
  });

  if (state === "merged") {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-violet-500">
          <GitMerge className="size-4" />
          Merged
        </p>
        {mergeCommitSha && (
          <p className="mt-1 text-xs text-muted-foreground">
            Merge commit{" "}
            <Link
              href={`/${username}/${repo}/commit/${mergeCommitSha}`}
              className="font-mono hover:underline"
            >
              {mergeCommitSha.slice(0, 7)}
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (state === "closed") {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        This pull request was closed without merging.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <p className="text-sm">
        {mergeable
          ? "This branch has no conflicts with the base branch."
          : "This branch has conflicts that must be resolved locally."}
      </p>

      <div className="flex flex-wrap gap-2">
        {canMerge && (
          <Button
            size="sm"
            disabled={!mergeable || merge.isExecuting}
            onClick={() => merge.execute({ username, repo, number })}
          >
            {merge.isExecuting && <Spinner />}
            <GitMerge data-icon="inline-start" />
            Merge pull request
          </Button>
        )}

        {(canMerge || isAuthor) && (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isExecuting}
            onClick={() => close.execute({ username, repo, number })}
          >
            {close.isExecuting && <Spinner />}
            Close pull request
          </Button>
        )}
      </div>
    </div>
  );
}
