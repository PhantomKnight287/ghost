import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CursorPagination } from "@/components/cursor-pagination";
import { ReleaseCard } from "@/components/releases/release-card";
import { createServerClient } from "@/lib/api/server";

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

  if (releases.response.status === 404) notFound();
  if (!releases.data) {
    throw new Error(`Failed to list releases of ${username}/${repo}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {releases.data.releases.length === 0 ? (
        <div className="rounded-lg border py-16 text-center">
          <p className="font-medium">There aren&apos;t any releases here</p>
          <p className="text-sm text-muted-foreground">
            Releases package a tag with notes about what changed.
          </p>
        </div>
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
