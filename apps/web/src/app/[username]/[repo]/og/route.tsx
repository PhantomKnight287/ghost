import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard, plural, shortenPath } from "@/lib/og";

/**
 * Cards for paths inside a repository. Next.js forbids an `opengraph-image`
 * beside an optional catch-all segment, so the tree and blob pages point their
 * metadata at this one route instead.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string; repo: string }> },
) {
  const { username, repo } = await params;
  const search = new URL(request.url).searchParams;
  const ref = search.get("ref") ?? "";
  const path = search.get("path") ?? "";
  const client = await createServerClient();

  if (search.get("kind") === "blob") {
    const { data } = await client.GET(
      "/api/repositories/{username}/{slug}/blob",
      { params: { path: { username, slug: repo }, query: { ref, path } } },
    );
    if (!data) notFound();

    return ogCard({
      eyebrow: `${username}/${repo}`,
      icon: "fileCode",
      badge: { label: ref },
      title: path.split("/").at(-1) ?? path,
      // the directory only: repeating the file name under itself reads badly
      description: shortenPath(path.split("/").slice(0, -1).join("/")) || null,
      stats: [
        { icon: "fileDiff", label: formatBytes(data.size) },
        ...(data.commit
          ? [
              {
                icon: "gitCommitHorizontal" as const,
                label: data.commit.sha.slice(0, 7),
              },
            ]
          : []),
      ],
    });
  }

  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/contents",
    {
      params: {
        path: { username, slug: repo },
        query: { ref, path: path || undefined },
      },
    },
  );
  if (!data) notFound();

  return ogCard({
    eyebrow: `${username}/${repo}`,
    icon: "folder",
    badge: { label: ref },
    title: path.split("/").at(-1) || repo,
    description: path
      ? shortenPath(path.split("/").slice(0, -1).join("/")) || null
      : (data.commit?.message ?? null),
    stats: [
      { icon: "fileCode", label: plural(data.entries.length, "entry", "entries") },
      { icon: "gitCommitHorizontal", label: plural(data.commitCount, "commit") },
    ],
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
