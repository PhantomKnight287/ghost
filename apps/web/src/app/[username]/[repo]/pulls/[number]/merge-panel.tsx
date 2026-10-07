"use client";

import { CircleCheck, CircleX, GitMerge, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { closePullRequest, setDraft } from "@/components/pull-requests/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UserLink } from "@/components/users/user-link";
import { MergeButton } from "./merge-button";

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
  pullRefsBlocked,
}: {
  username: string;
  repo: string;
  number: number;
  state: "open" | "closed" | "merged";
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
  /** Why `refs/pull/<number>/*` stopped following the branches, or null while they are current. */
  pullRefsBlocked: string | null;
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
      {pullRefsBlocked && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            <code>refs/pull/{number}/head</code> is not following this branch
          </AlertTitle>
          <AlertDescription>
            {pullRefsBlocked} A fetch of <code>pull/{number}/head</code> or{" "}
            <code>pull/{number}/merge</code> gets the branch as of the last
            update that fit, or fails if no update has fit yet.
          </AlertDescription>
        </Alert>
      )}

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
