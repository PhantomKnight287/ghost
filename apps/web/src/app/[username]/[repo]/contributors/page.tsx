import { Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createServerClient } from "@/lib/api/server";

export default async function ContributorsPage({
  params,
}: PageProps<"/[username]/[repo]/contributors">) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/contributors",
    { params: { path: { username, slug: repo } } },
  );

  if (!data) notFound();

  const top = data.contributors[0]?.commits ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <Users className="size-4.5 text-muted-foreground" />
        Contributors
        <span className="text-sm font-normal text-muted-foreground tabular-nums">
          {data.totalContributors} · {data.totalCommits} commits
        </span>
      </h1>

      {data.contributors.length === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          No commits on this repository yet.
        </p>
      ) : (
        <TooltipProvider>
          <ul className="divide-y rounded-lg border">
            {data.contributors.map((contributor) => (
              <li
                key={`${contributor.username ?? contributor.name}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Avatar className="size-9">
                  <AvatarImage src={contributor.image ?? undefined} alt="" />
                  <AvatarFallback>
                    {contributor.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex min-w-0 flex-col">
                  {contributor.username ? (
                    <>
                      <Link
                        href={`/${contributor.username}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {contributor.name}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        {contributor.username}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-sm font-medium">
                        {contributor.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        no Ghost account
                      </span>
                    </>
                  )}
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="h-2 w-24 overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`${contributor.commits} commits`}
                      >
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{
                            width: `${top > 0 ? (contributor.commits / top) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {contributor.commits} commits (
                      {contributor.percent.toFixed(1)}%)
                    </TooltipContent>
                  </Tooltip>

                  <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
                    {contributor.commits}{" "}
                    {contributor.commits === 1 ? "commit" : "commits"}
                  </span>

                  <span className="hidden w-28 text-right text-xs text-muted-foreground sm:inline">
                    <FromNowHoverCard date={contributor.lastCommittedAt} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </TooltipProvider>
      )}
    </div>
  );
}
