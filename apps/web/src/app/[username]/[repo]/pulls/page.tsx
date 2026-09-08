import { GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import type { PullRequestFilter } from "@/components/pull-requests/common";
import { pullRequestFilters } from "@/components/pull-requests/common";
import { Button, buttonVariants } from "@/components/ui/button";
import { createServerClient } from "@/lib/api/server";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export default async function PullRequestsPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/pulls">) {
  const { username, repo } = await params;
  const { state, cursor } = await searchParams;

  const filter: PullRequestFilter = pullRequestFilters.includes(
    state as PullRequestFilter,
  )
    ? (state as PullRequestFilter)
    : "open";

  const client = await createServerClient();
  const pulls = await client.GET("/api/repositories/{username}/{repo}/pulls", {
    params: {
      path: { username, repo },
      query: {
        state: filter,
        limit: PAGE_SIZE,
        cursor: typeof cursor === "string" ? cursor : undefined,
      },
    },
  });

  if (pulls.response.status === 404) notFound();
  if (!pulls.data) {
    throw new Error(`Failed to list pull requests of ${username}/${repo}`);
  }

  const base = `/${username}/${repo}/pulls`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {pullRequestFilters.map((option) => (
            <Link
              key={option}
              href={option === "open" ? base : `${base}?state=${option}`}
              className={cn(
                buttonVariants({
                  variant: option === filter ? "secondary" : "ghost",
                  size: "sm",
                }),
                "capitalize",
              )}
            >
              {option}
            </Link>
          ))}
        </div>

        <Button size="sm" className="ml-auto" asChild>
          <Link href={`${base}/new`}>
            <GitPullRequest data-icon="inline-start" />
            New pull request
          </Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {pulls.data.pullRequests.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {filter === "all"
              ? "This repository has no pull requests yet."
              : `There are no ${filter} pull requests.`}
          </p>
        ) : (
          <ul className="divide-y">
            {pulls.data.pullRequests.map((pull) => {
              const Icon =
                pull.state === "merged"
                  ? GitMerge
                  : pull.state === "closed"
                    ? GitPullRequestClosed
                    : GitPullRequest;

              return (
                <li
                  key={pull.id}
                  className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      pull.state === "merged" && "text-violet-500",
                      pull.state === "closed" && "text-red-500",
                      pull.state === "open" && "text-emerald-500",
                    )}
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`${base}/${pull.number}`}
                      className="font-medium hover:underline"
                    >
                      {pull.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      #{pull.number} opened{" "}
                      <FromNowHoverCard date={pull.createdAt} /> by{" "}
                      {pull.authorUsername}
                    </p>
                  </div>

                  <code className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:block">
                    {pull.head.username === pull.base.username
                      ? pull.head.ref
                      : `${pull.head.username}:${pull.head.ref}`}
                    {" → "}
                    {pull.base.ref}
                  </code>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pulls.data.nextCursor && (
        <div className="flex justify-end">
          <Link
            href={`${base}?state=${filter}&cursor=${encodeURIComponent(pulls.data.nextCursor)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Older
          </Link>
        </div>
      )}
    </div>
  );
}
