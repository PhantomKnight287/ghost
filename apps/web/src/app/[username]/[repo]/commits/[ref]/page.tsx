import Link from "next/link";
import { notFound } from "next/navigation";
import { GitCommitHorizontal } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { createServerClient } from "@/lib/api/server";
import { FromNowHoverCard } from "@/components/from-now-card";

const PAGE_SIZE = 20;

export default async function RepositoryCommitsPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/commits/[ref]">) {
  const { username, repo, ref } = await params;
  const { cursor } = await searchParams;

  const client = await createServerClient();

  const revision = decodeURIComponent(ref);

  const commits = await client.GET(
    "/api/repositories/{username}/{slug}/commits",
    {
      params: {
        path: { username, slug: repo },
        query: {
          ref: revision,
          limit: PAGE_SIZE,
          cursor: typeof cursor === "string" ? cursor : undefined,
        },
      },
    },
  );

  if (commits.response.status === 404) notFound();
  if (!commits.data) {
    throw new Error(`Failed to list commits of ${username}/${repo}`);
  }

  const { from, to, total, nextCursor } = commits.data;
  const base = `/${username}/${repo}/commits/${encodeURIComponent(revision)}`;

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
          <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">Commits on {revision}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {total === 0 ? "No commits" : `${from}–${to} of ${total}`}
          </span>
        </div>

        {commits.data.commits.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nothing has been pushed to {revision} yet.
          </p>
        ) : (
          <ul className="divide-y">
            {commits.data.commits.map((commit) => (
              <li
                key={commit.sha}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/${username}/${repo}/commit/${commit.sha}`}
                    className="truncate font-medium hover:underline"
                  >
                    {commit.subject}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {commit.authorName} committed{" "}
                    <FromNowHoverCard date={commit.committedAt} />
                  </p>
                </div>
                <Link
                  className="hover:underline"
                  href={`/${username}/${repo}/commit/${commit.sha}`}
                >
                  <code className="shrink-0 text-xs text-muted-foreground">
                    {commit.sha.slice(0, 7)}
                  </code>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(cursor || nextCursor) && (
        <div className="flex justify-center gap-2">
          <Link
            href={base}
            aria-disabled={!cursor}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: cursor ? "" : "pointer-events-none opacity-50",
            })}
          >
            Newest
          </Link>
          <Link
            href={nextCursor ? `${base}?cursor=${nextCursor}` : base}
            aria-disabled={!nextCursor}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: nextCursor ? "" : "pointer-events-none opacity-50",
            })}
          >
            Older
          </Link>
        </div>
      )}
    </>
  );
}
