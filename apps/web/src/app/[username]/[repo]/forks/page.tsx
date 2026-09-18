import { GitFork } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { buttonVariants } from "@/components/ui/button";
import { createServerClient } from "@/lib/api/server";
import { cn } from "@/lib/utils";

export default async function ForksPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/forks">) {
  const { username, repo } = await params;
  const { cursor } = await searchParams;

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/forks",
    {
      params: {
        path: { username, slug: repo },
        query: { cursor: typeof cursor === "string" ? cursor : undefined },
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
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">No one has forked this yet</p>
          <Link
            href={`/${username}/${repo}/fork`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Fork this repository
          </Link>
        </div>
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

      {data.nextCursor && (
        <Link
          href={`/${username}/${repo}/forks?cursor=${encodeURIComponent(data.nextCursor)}`}
          className={cn(buttonVariants({ variant: "outline" }), "self-center")}
        >
          Next page
        </Link>
      )}
    </div>
  );
}
