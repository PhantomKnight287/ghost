import { Star } from "lucide-react";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { buttonVariants } from "@/components/ui/button";
import { createServerClient } from "@/lib/api/server";
import { cn } from "@/lib/utils";

export default async function StargazersPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/stargazers">) {
  const { username, repo } = await params;
  const { cursor } = await searchParams;

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/stargazers",
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
        <Star className="size-4.5 text-muted-foreground" />
        Stargazers
      </h1>

      {data.stargazers.length === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          No one has starred this repository yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.stargazers.map((stargazer) => (
            <li
              key={stargazer.username}
              className="flex items-center gap-3 px-4 py-3"
            >
              <ProfileAvatar
                name={stargazer.name}
                image={stargazer.image}
                className="size-9"
              />

              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/${stargazer.username}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {stargazer.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {stargazer.username}
                </span>
              </div>

              <span className="ml-auto text-xs text-muted-foreground">
                starred <FromNowHoverCard date={stargazer.starredAt} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.nextCursor && (
        <Link
          href={`/${username}/${repo}/stargazers?cursor=${encodeURIComponent(data.nextCursor)}`}
          className={cn(buttonVariants({ variant: "outline" }), "self-center")}
        >
          Next page
        </Link>
      )}
    </div>
  );
}
