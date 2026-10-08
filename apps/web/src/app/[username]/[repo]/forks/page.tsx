import { GitFork } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { buttonVariants } from "@/components/ui/button";
import { createServerClient } from "@/lib/api/server";
import { cn } from "@/lib/utils";
import { CursorPagination } from "@/components/cursor-pagination";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function ForksPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/forks">) {
  const { username, repo } = await params;
  const { cursor } = await searchParams;
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/forks",
    {
      params: {
        path: { username, slug: repo },
        query: { cursor: pageCursor },
      },
    },
  );

  if (!data) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <GitFork className="size-4.5 text-muted-foreground" />
        Forks
      </h1>

      {data.forks.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No one has forked this yet</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Link
              href={`/${username}/${repo}/fork`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Fork this repository
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.forks.map((fork) => (
            <li
              key={`${fork.username}/${fork.slug}`}
              className="flex flex-col gap-1 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Link
                  href={`/${fork.username}/${fork.slug}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {fork.username}/{fork.name}
                </Link>
                <span className="ml-auto text-xs text-muted-foreground">
                  pushed <FromNowHoverCard date={fork.lastPushedAt} />
                </span>
              </div>

              {fork.description && (
                <p className="text-sm text-muted-foreground">
                  {fork.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <CursorPagination
        pathname={`/${username}/${repo}/forks`}
        cursor={pageCursor}
        nextCursor={data.nextCursor}
      />
    </div>
  );
}
