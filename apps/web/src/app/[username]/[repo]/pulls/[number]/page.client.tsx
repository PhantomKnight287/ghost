"use client";

import { CircleCheck, CircleX, GitMerge } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { closePullRequest, setDraft } from "@/components/pull-requests/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UserLink } from "@/components/users/user-link";
import { cn } from "@/lib/utils";
import { MergeButton } from "./merge-button";

export function PullRequestNav({
  base,
  commitCount,
  changedFiles,
  additions,
  deletions,
}: {
  base: string;
  commitCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: base, label: "Overview", count: null },
    { href: `${base}/commits`, label: "Commits", count: commitCount },
    { href: `${base}/files`, label: "Files changed", count: changedFiles },
  ];

  return (
    // the tab labels carry counts, so on a phone the row wraps instead of pushing the whole page sideways
    <nav className="flex flex-wrap items-center gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
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
      <div className="ml-auto flex flex-row items-center justify-center gap-1 text-xs">
        <span className="text-green-400">+{additions}</span>
        <span className="text-red-400">-{deletions}</span>
      </div>
    </nav>
  );
}

export function MergePanel({
  username,
  repo,
  number,
  state,
  mergeable,
  conflicts,
  canMerge,
  isAuthor,
  mergeCommitSha,
  draft,
  squash,
  reviewers,
}: {
  username: string;
  repo: string;
  number: number;
  state: string;
  mergeable: boolean;
  /** Paths that conflict with the base right now. */
  conflicts: string[];
  canMerge: boolean;
  isAuthor: boolean;
  mergeCommitSha: string | null;
  draft: boolean;
  squash: { title: string; message: string } | null;
  reviewers: {
    username: string;
    image: string | null;
    state: "approved" | "changes_requested";
  }[];
}) {
  const router = useRouter();

  const draftToggle = useAction(setDraft, {
    onSuccess: ({ input }) => {
      toast.success(
        input.draft
          ? "Pull request converted to a draft."
          : "Pull request marked ready for review.",
      );
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not change this pull request."),
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
            Merged as{" "}
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
      {reviewers.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {reviewers.map((reviewer) => (
            <li key={reviewer.username} className="flex items-center gap-2">
              {reviewer.state === "approved" ? (
                <CircleCheck className="size-4 text-emerald-500" />
              ) : (
                <CircleX className="size-4 text-red-500" />
              )}
              <UserLink
                username={reviewer.username}
                image={reviewer.image}
                avatar="sm"
              />
              <span className="text-muted-foreground">
                {reviewer.state === "approved"
                  ? "approved"
                  : "requested changes"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        {draft
          ? "This pull request is still a draft and cannot be merged."
          : mergeable
            ? "This branch has no conflicts with the base branch."
            : "This branch has conflicts that must be resolved locally."}
      </p>

      {conflicts.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
          {conflicts.map((path) => (
            <li key={path} className="truncate">
              {path}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1">
          {draft
            ? (canMerge || isAuthor) && (
                <Button
                  size="sm"
                  disabled={draftToggle.isExecuting}
                  onClick={() =>
                    draftToggle.execute({
                      username,
                      repo,
                      number,
                      draft: false,
                    })
                  }
                >
                  {draftToggle.isExecuting && <Spinner />}
                  Ready for review
                </Button>
              )
            : canMerge && (
                <MergeButton
                  username={username}
                  repo={repo}
                  number={number}
                  disabled={!mergeable}
                  squash={squash}
                />
              )}
        </div>

        {(canMerge || isAuthor) && (
          <div className="flex gap-2">
            {!draft && (
              <Button
                size="sm"
                variant="ghost"
                disabled={draftToggle.isExecuting}
                onClick={() =>
                  draftToggle.execute({ username, repo, number, draft: true })
                }
              >
                {draftToggle.isExecuting && <Spinner />}
                Convert to draft
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={close.isExecuting}
              onClick={() => close.execute({ username, repo, number })}
            >
              {close.isExecuting && <Spinner />}
              Close pull request
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
