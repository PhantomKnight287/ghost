import { GitCommitHorizontal, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CursorPagination } from "@/components/cursor-pagination";
import { FromNowHoverCard } from "@/components/from-now-card";
import { createServerClient } from "@/lib/api/server";

export async function generateMetadata({
  params,
}: PageProps<"/[username]/[repo]/tags">): Promise<Metadata> {
  const { username, repo } = await params;
  return { title: `Tags · ${username}/${repo}` };
}

export default async function TagsPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/tags">) {
  const { username, repo } = await params;
  const { cursor } = await searchParams;
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const client = await createServerClient();
  const tags = await client.GET("/api/repositories/{username}/{slug}/tags", {
    params: { path: { username, slug: repo }, query: { cursor: pageCursor } },
  });

  if (tags.response.status === 404) notFound();
  if (!tags.data) throw new Error(`Failed to list tags of ${username}/${repo}`);

  return (
    <div className="flex flex-col gap-4">
      {tags.data.tags.length === 0 ? (
        <div className="rounded-lg border py-16 text-center">
          <p className="font-medium">There aren&apos;t any tags here</p>
          <p className="text-sm text-muted-foreground">
            Push one with <code>git push origin v1.0.0</code>, or create one
            with a release.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tags.data.tags.map((tag) => (
            <li
              key={tag.name}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <Tag className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/${username}/${repo}/tree/${encodeURIComponent(tag.name)}`}
                  className="truncate font-medium hover:underline"
                >
                  {tag.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {tag.message && <>{tag.message} · </>}
                  <FromNowHoverCard date={tag.createdAt} />
                </p>
              </div>
              <Link
                href={`/${username}/${repo}/commit/${tag.sha}`}
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                <GitCommitHorizontal className="size-3.5" />
                <code>{tag.sha.slice(0, 7)}</code>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CursorPagination
        pathname={`/${username}/${repo}/tags`}
        cursor={pageCursor}
        nextCursor={tags.data.nextCursor}
      />
    </div>
  );
}
