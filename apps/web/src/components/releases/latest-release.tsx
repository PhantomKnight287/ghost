import { Tag } from "lucide-react";
import Link from "next/link";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createServerClient } from "@/lib/api/server";

import { releasePath } from "./common";

/** The repository sidebar's releases section: the latest release, and the way to every release and tag. */
export async function LatestRelease({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const client = await createServerClient();
  const { data, response } = await client.GET(
    "/api/repositories/{username}/{repo}/releases/latest",
    { params: { path: { username, repo } } },
  );
  // a 404 is "nothing published yet"; anything else without data is a failure, not an empty state
  if (!data && response.status !== 404) {
    throw new Error(
      `Failed to load the latest release of ${username}/${repo} (${response.status})`,
    );
  }
  const base = `/${username}/${repo}`;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        <Link href={`${base}/releases`} className="hover:text-primary">
          Releases
        </Link>
      </h2>

      {data ? (
        <Link
          href={releasePath(username, repo, data.tagName)}
          className="group flex items-start gap-2 text-sm"
        >
          <Tag className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium group-hover:underline">
                {data.name ?? data.tagName}
              </span>
              <Badge variant="outline">Latest</Badge>
            </span>
            {data.publishedAt && (
              <FromNowHoverCard
                date={data.publishedAt}
                className="text-xs text-muted-foreground"
              />
            )}
          </span>
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">No releases published.</p>
      )}

      <Link
        href={`${base}/tags`}
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        View all tags
      </Link>
    </div>
  );
}

export function LatestReleaseSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-20" />
      <div className="flex items-start gap-2">
        <Skeleton className="size-4" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}
