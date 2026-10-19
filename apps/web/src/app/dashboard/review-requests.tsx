"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { FromNowHoverCard } from "@/components/from-now-card";
import { ThreadStateIcon } from "@/components/thread-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, unwrap } from "@/lib/api/client";

/** Open pull requests asking the viewer for a review, directly or through one of their teams. */
export function ReviewRequests() {
  const { data, isPending } = useQuery({
    queryKey: ["review-requests"],
    queryFn: () => unwrap(apiClient.GET("/api/user/review-requests")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review requests</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <ul className="flex flex-col divide-y">
            {[0, 1].map((row) => (
              <li key={row} className="py-3 first:pt-0 last:pb-0">
                <ReviewRequestSkeleton />
              </li>
            ))}
          </ul>
        ) : data?.pullRequests.length ? (
          <ul className="flex flex-col divide-y">
            {data.pullRequests.map((pull) => (
              <li
                key={pull.id}
                className="flex items-start gap-3 py-3 text-sm first:pt-0 last:pb-0"
              >
                <ThreadStateIcon
                  isPullRequest
                  state={pull.state}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/${pull.base.username}/${pull.base.slug}/pull/${pull.number}`}
                    className="font-medium hover:underline"
                  >
                    {pull.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {pull.base.username}/{pull.base.slug}#{pull.number} opened{" "}
                    <FromNowHoverCard date={pull.createdAt} /> by{" "}
                    {pull.authorUsername}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No pull requests are waiting on your review.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewRequestSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="mt-0.5 size-4" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
