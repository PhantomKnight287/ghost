import { GitCommitHorizontal } from "lucide-react";

import { CommitList } from "@/components/repositories/commit-list";
import { CursorPagination } from "@/components/cursor-pagination";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";

const PAGE_SIZE = 20;

export default async function RepositoryCommitsPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/commits/[...ref]">) {
  const { username, repo, ref } = await params;
  const { cursor } = await searchParams;
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const client = await createServerClient();

  // a branch like `feat/x` arrives as more than one segment
  const revision = ref.map(decodeURIComponent).join("/");

  const commits = await client.GET(
    "/api/repositories/{username}/{slug}/commits",
    {
      params: {
        path: { username, slug: repo },
        query: {
          ref: revision,
          limit: PAGE_SIZE,
          cursor: pageCursor,
        },
      },
    },
  );

  notFoundIfHidden(commits.response);
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

        <CommitList
          commits={commits.data.commits}
          commitBase={`/${username}/${repo}`}
          empty={`Nothing has been pushed to ${revision} yet.`}
        />
      </div>

      <CursorPagination
        pathname={base}
        cursor={pageCursor}
        nextCursor={nextCursor}
      />
    </>
  );
}
