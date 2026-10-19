import { Eye, GitPullRequest } from "lucide-react";
import Link from "next/link";

import { UserLink } from "@/components/users/user-link";
import { FromNowHoverCard } from "@/components/from-now-card";
import {
  branchLabel,
  pullRequestFilters,
} from "@/components/pull-requests/common";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";
import { cn } from "@/lib/utils";
import { CursorPagination } from "@/components/cursor-pagination";
import { ThreadStateIcon } from "@/components/thread-state";

const PAGE_SIZE = 20;

export default async function PullRequestsPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/pulls">) {
  const { username, repo } = await params;
  const { state, cursor, reviewRequested } = await searchParams;
  const pageCursor = typeof cursor === "string" ? cursor : undefined;
  // A username or `@me`: pull requests asking them for a review, directly or through a team.
  const reviewer =
    typeof reviewRequested === "string" && reviewRequested
      ? reviewRequested
      : undefined;

  const filter = pullRequestFilters.find((value) => value === state) ?? "open";

  const client = await createServerClient();
  const pulls = await client.GET("/api/repositories/{username}/{repo}/pulls", {
    params: {
      path: { username, repo },
      query: {
        state: filter,
        limit: PAGE_SIZE,
        cursor: pageCursor,
        reviewRequested: reviewer,
      },
    },
  });

  notFoundIfHidden(pulls.response);
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
              href={{
                pathname: base,
                query: {
                  ...(option !== "open" && { state: option }),
                  ...(reviewer && { reviewRequested: reviewer }),
                },
              }}
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

        <Link
          href={{
            pathname: base,
            query: {
              ...(filter !== "open" && { state: filter }),
              ...(!reviewer && { reviewRequested: "@me" }),
            },
          }}
          className={buttonVariants({
            variant: reviewer ? "secondary" : "ghost",
            size: "sm",
          })}
        >
          <Eye data-icon="inline-start" />
          Review requested
        </Link>

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
            {reviewer
              ? "No pull requests match this filter."
              : filter === "all"
                ? "This repository has no pull requests yet."
                : `There are no ${filter} pull requests.`}
          </p>
        ) : (
          <ul className="divide-y">
            {pulls.data.pullRequests.map((pull) => {
              return (
                <li
                  key={pull.id}
                  className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                >
                  <ThreadStateIcon
                    isPullRequest
                    state={pull.state}
                    className="mt-0.5"
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${username}/${repo}/pull/${pull.number}`}
                      className="font-medium hover:underline"
                    >
                      {pull.title}
                    </Link>
                    {pull.draft && pull.state === "open" && (
                      <Badge variant="outline" className="ml-2 rounded-full">
                        Draft
                      </Badge>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      #{pull.number} opened{" "}
                      <FromNowHoverCard date={pull.createdAt} /> by{" "}
                      <UserLink
                        username={pull.authorUsername}
                        className="font-normal text-muted-foreground"
                      />
                    </p>
                  </div>

                  <code className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:block">
                    {branchLabel(pull.head, pull.base)}
                    {" → "}
                    {pull.base.ref}
                  </code>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CursorPagination
        pathname={base}
        params={{ state: filter, reviewRequested: reviewer }}
        cursor={pageCursor}
        nextCursor={pulls.data.nextCursor}
      />
    </div>
  );
}
