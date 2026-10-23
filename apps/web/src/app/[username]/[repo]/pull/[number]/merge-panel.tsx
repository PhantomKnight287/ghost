"use client";

import { cn } from "cn";
import {
  CircleCheck,
  CircleX,
  ShieldAlert,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { closePullRequest, setDraft } from "@/components/pull-requests/actions";
import { CommitChecks } from "@/components/repositories/commit-checks";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { mergeMethods } from "@/components/pull-requests/common";
import { Spinner } from "@/components/ui/spinner";
import { UserLink } from "@/components/users/user-link";
import type { components } from "@/lib/api/v1";
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
  checks,
  requirements,
  baseRef,
  headRef,
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
  /** Statuses on the head commit, or null when it has none. */
  checks: components["schemas"]["CombinedCommitStatusDTO"] | null;
  /** What the rulesets ask of this merge, for a viewer who can merge; null for anyone else. */
  requirements: components["schemas"]["MergeRequirementsDTO"] | null;
  baseRef: string;
  headRef: string;
}) {
  const router = useRouter();
  const [bypassing, setBypassing] = useState(false);

  // The method menu offers only allowed methods, so a method requirement is shown as an empty menu, not a row; with none allowed, a bypasser may still use any.
  const shown = (list: components["schemas"]["RuleViolationDTO"][]) =>
    list.filter(({ requirement }) => requirement !== "merge_method");
  const blocking = shown(requirements?.violations ?? []);
  const bypassable = shown(requirements?.bypassed ?? []);
  const methodBypassable = (requirements?.bypassed ?? []).some(
    ({ requirement }) => requirement === "merge_method",
  );
  const allowed = requirements?.allowedMethods ?? [...mergeMethods];
  const methods =
    allowed.length > 0 ? allowed : methodBypassable ? [...mergeMethods] : [];
  const needsBypass =
    bypassable.length > 0 || (allowed.length === 0 && methodBypassable);
  const blocked = blocking.length > 0 || methods.length === 0;

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

  const checksSection = checks && (
    <CommitChecks
      status={checks}
      required={requirements?.requiredContexts}
      className="rounded-none border-0 px-4 py-3"
    />
  );

  if (state === "merged") {
    return (
      <div className="divide-y overflow-hidden rounded-lg border">
        {checksSection}
        <Section
          icon={<GitMerge className="size-4" />}
          tone="bg-violet-500 text-white"
          title="Pull request successfully merged and closed"
        >
          <Branch name={headRef} /> was merged into <Branch name={baseRef} />
          {mergeCommitSha && (
            <>
              {" "}
              as{" "}
              <Link
                href={`/${username}/${repo}/commit/${mergeCommitSha}`}
                className="font-mono text-foreground hover:underline"
              >
                {mergeCommitSha.slice(0, 7)}
              </Link>
            </>
          )}
          .
        </Section>
      </div>
    );
  }

  if (state === "closed") {
    return (
      <div className="divide-y overflow-hidden rounded-lg border">
        {checksSection}
        <Section
          icon={<GitPullRequestClosed className="size-4" />}
          tone="bg-red-500 text-white"
          title="Closed with unmerged commits"
        >
          This pull request was closed without merging <Branch name={headRef} />{" "}
          into <Branch name={baseRef} />.
        </Section>
      </div>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-lg border">
      {pullRefsBlocked && (
        <div className="px-4 py-3">
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
        </div>
      )}

      {reviewers.length > 0 && (
        <ul className="flex flex-col gap-1 px-4 py-3 text-sm">
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

      {checksSection}

      {draft ? (
        <Section
          icon={<GitPullRequestDraft className="size-4" />}
          tone="bg-muted text-muted-foreground"
          title="This pull request is still a draft"
        >
          Mark it ready for review to merge it.
        </Section>
      ) : mergeable ? (
        <Section
          icon={<CircleCheck className="size-4" />}
          tone="bg-emerald-500 text-white"
          title="This branch has no conflicts with the base branch"
        >
          Merging <Branch name={headRef} /> into <Branch name={baseRef} /> can
          be performed automatically.
        </Section>
      ) : (
        <Section
          icon={<CircleX className="size-4" />}
          tone="bg-red-500 text-white"
          title="This branch has conflicts that must be resolved"
        >
          Resolve them locally, then push to <Branch name={headRef} />.
          {conflicts.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
              {conflicts.map((path) => (
                <li key={path} className="truncate">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {!draft &&
        (blocking.length > 0 ||
          bypassable.length > 0 ||
          methods.length === 0) && (
          <Section
            icon={<ShieldAlert className="size-4" />}
            tone={blocked ? "bg-red-500 text-white" : "bg-amber-500 text-white"}
            title={
              blocked
                ? "Merging is blocked"
                : "Merging is blocked, but you can bypass the rules"
            }
          >
            {methods.length === 0 && (
              <p>No merge method is allowed by every ruleset on this branch.</p>
            )}
            <ul className="mt-1 flex flex-col gap-1">
              {[...blocking, ...bypassable].map((violation) => (
                <li
                  key={`${violation.rulesetId}:${violation.requirement ?? violation.rule}`}
                >
                  <span className="whitespace-pre-line text-foreground">
                    {violation.message}
                  </span>{" "}
                  <Link
                    href={`/${username}/${repo}/settings/rules/${violation.rulesetId}`}
                    className="hover:underline"
                  >
                    ({violation.rulesetName})
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

      {(canMerge || isAuthor) && (
        <div className="flex flex-wrap items-start gap-2 bg-muted/30 px-4 py-3">
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
                  <div className="flex flex-col gap-2">
                    {!blocked && needsBypass && (
                      <label
                        htmlFor="bypass-rules"
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          id="bypass-rules"
                          checked={bypassing}
                          onCheckedChange={(checked) =>
                            setBypassing(checked === true)
                          }
                        />
                        Merge anyway, bypassing ruleset requirements
                      </label>
                    )}
                    <MergeButton
                      username={username}
                      repo={repo}
                      number={number}
                      disabled={
                        !mergeable || blocked || (needsBypass && !bypassing)
                      }
                      methods={methods}
                      bypassRules={needsBypass && bypassing}
                      squash={squash}
                    />
                  </div>
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
      )}
    </div>
  );
}

/** One row of the merge box: a round state badge, a title, and a line of detail under it. */
function Section({
  icon,
  tone,
  title,
  children,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tone,
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-xs text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function Branch({ name }: { name: string }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
      {name}
    </code>
  );
}
