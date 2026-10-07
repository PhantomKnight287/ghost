import type { Metadata } from "next";

import { CursorPagination } from "@/components/cursor-pagination";
import { ReleaseCard } from "@/components/releases/release-card";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export async function generateMetadata({
  params,
}: PageProps<"/[username]/[repo]/releases">): Promise<Metadata> {
  const { username, repo } = await params;
  return { title: `Releases · ${username}/${repo}` };
}

export default async function ReleasesPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/releases">) {
  const { username, repo } = await params;
  const { cursor } = await searchParams;
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const client = await createServerClient();
  const releases = await client.GET(
    "/api/repositories/{username}/{repo}/releases",
    { params: { path: { username, repo }, query: { cursor: pageCursor } } },
  );

  notFoundIfHidden(releases.response);
  if (!releases.data) {
    throw new Error(`Failed to list releases of ${username}/${repo}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {releases.data.releases.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>There aren&apos;t any releases here</EmptyTitle>
            <EmptyDescription>
              Releases package a tag with notes about what changed.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        releases.data.releases.map((release) => (
          <ReleaseCard
            key={release.id}
            username={username}
            repo={repo}
            release={release}
          />
        ))
      )}

      <CursorPagination
        pathname={`/${username}/${repo}/releases`}
        cursor={pageCursor}
        nextCursor={releases.data.nextCursor}
      />
    </div>
  );
}
