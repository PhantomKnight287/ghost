import Link from "next/link";
import { notFound } from "next/navigation";

import { FromNowHoverCard } from "@/components/from-now-card";
import { createServerClient } from "@/lib/api/server";

export default async function PullRequestCommitsPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]/commits">) {
  const { username, repo, number } = await params;

  const client = await createServerClient();
  const path = { username, repo, number: Number(number) };

  const [commits, pull] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}/commits", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
      params: { path },
    }),
  ]);

  if (commits.response.status === 404) notFound();
  if (!commits.data || !pull.data) {
    throw new Error(`Failed to list commits of pull request #${number}`);
  }

  // These commits are reachable in the head repository, which is a different
  // repository - and a different object store - whenever the request is a fork.
  const { head } = pull.data;

  return (
    <div className="overflow-hidden rounded-lg border">
      {commits.data.commits.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          This branch adds no commits to the base.
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
                  href={`/${head.username}/${head.slug}/commit/${commit.sha}`}
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
                href={`/${head.username}/${head.slug}/commit/${commit.sha}`}
                className="shrink-0 font-mono text-xs text-muted-foreground hover:underline"
              >
                {commit.sha.slice(0, 7)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
