import type { Metadata } from "next";
import Link from "next/link";

import { ReleaseCard } from "@/components/releases/release-card";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";

export async function generateMetadata({
  params,
}: PageProps<"/[username]/[repo]/releases/tag/[...tag]">): Promise<Metadata> {
  const { username, repo, tag } = await params;
  const tagName = tag.map(decodeURIComponent).join("/");
  const title = `${tagName} · ${username}/${repo}`;
  const image = `/${username}/${repo}/releases/og?${new URLSearchParams({ tag: tagName })}`;

  return {
    title,
    openGraph: { title, images: [image] },
    twitter: { images: [image] },
  };
}

export default async function ReleasePage({
  params,
}: PageProps<"/[username]/[repo]/releases/tag/[...tag]">) {
  const { username, repo, tag } = await params;
  const tagName = tag.map(decodeURIComponent).join("/");

  const client = await createServerClient();
  const release = await client.GET(
    "/api/repositories/{username}/{repo}/releases/tags/{tag}",
    { params: { path: { username, repo, tag: tagName } } },
  );

  notFoundIfHidden(release.response);
  if (!release.data) {
    throw new Error(`Failed to load release ${tagName} of ${username}/${repo}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-sm">
        <Link
          href={`/${username}/${repo}/releases`}
          className="text-primary hover:underline"
        >
          Releases
        </Link>
        <span className="text-muted-foreground"> / {tagName}</span>
      </nav>
      <ReleaseCard username={username} repo={repo} release={release.data} />
    </div>
  );
}
