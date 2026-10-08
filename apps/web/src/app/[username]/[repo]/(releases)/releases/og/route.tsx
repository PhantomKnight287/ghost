import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { ogCard, plural } from "@/lib/og";

/** The card for one release. Next.js forbids an `opengraph-image` beside a catch-all segment, so the tag page points its metadata here with the tag in the query. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string; repo: string }> },
) {
  const { username, repo } = await params;
  const tag = new URL(request.url).searchParams.get("tag") ?? "";

  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/releases/tags/{tag}",
    { params: { path: { username, repo, tag } } },
  );
  // drafts are hidden from the crawler like a private repository
  if (!data) notFound();

  const badge = data.isDraft
    ? { label: "draft" }
    : data.isPrerelease
      ? { label: "pre-release", color: "#e8c77d" }
      : data.isLatest
        ? { label: "latest", color: "#7dd3a0" }
        : undefined;

  return ogCard({
    eyebrow: `${username}/${repo} · release`,
    icon: "tag",
    badge,
    title: data.name ?? data.tagName,
    description: data.body,
    stats: [
      { icon: "tag", label: data.tagName },
      ...(data.authorUsername
        ? [{ icon: "user" as const, label: data.authorUsername }]
        : []),
      ...(data.assets.length
        ? [
            {
              icon: "fileDiff" as const,
              label: plural(data.assets.length, "asset"),
            },
          ]
        : []),
    ],
  });
}
