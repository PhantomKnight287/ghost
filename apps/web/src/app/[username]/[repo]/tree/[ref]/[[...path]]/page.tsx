import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { RepositoryContents } from "@/components/repositories/repository-contents";
import {
  RepositoryReadme,
  RepositoryReadmeSkeleton,
} from "@/components/repositories/repository-readme";
import { createServerClient } from "@/lib/api/server";
import { ogUrl } from "@/lib/og-url";

export async function generateMetadata({
  params,
}: PageProps<"/[username]/[repo]/tree/[ref]/[[...path]]">): Promise<Metadata> {
  const { username, repo, ref, path } = await params;
  const segments = (path ?? []).map(decodeURIComponent);
  const revision = decodeURIComponent(ref);

  const location = segments.length ? `${segments.join("/")} at ` : "";
  const title = `${username}/${repo} · ${location}${revision}`;
  const image = ogUrl({
    username,
    repo,
    ref: revision,
    path: segments.join("/"),
  });

  return {
    title,
    openGraph: { title, images: [image] },
    twitter: { images: [image] },
  };
}

export default async function RepositoryTreePage({
  params,
}: PageProps<"/[username]/[repo]/tree/[ref]/[[...path]]">) {
  const { username, repo, ref, path } = await params;

  const client = await createServerClient();

  const revision = decodeURIComponent(ref);
  const segments = (path ?? []).map(decodeURIComponent);

  const contents = await client.GET(
    "/api/repositories/{username}/{slug}/contents",
    {
      params: {
        path: { username, slug: repo },
        query: { ref: revision, path: segments.join("/") || undefined },
      },
    },
  );

  if (contents.response.status === 404) notFound();
  if (!contents.data) throw new Error(`Failed to list ${username}/${repo}`);

  return (
    <>
      <RepositoryContents
        contents={contents.data}
        owner={username}
        slug={repo}
      />
      {/* the README of this directory, the way the root page shows the root one */}
      <Suspense fallback={<RepositoryReadmeSkeleton />}>
        <Readme
          username={username}
          repo={repo}
          revision={revision}
          path={segments.join("/")}
        />
      </Suspense>
    </>
  );
}

async function Readme({
  username,
  repo,
  // not `ref`: React reserves that prop name
  revision,
  path,
}: {
  username: string;
  repo: string;
  revision: string;
  path: string;
}) {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/readme",
    {
      params: {
        path: { username, slug: repo },
        query: { ref: revision, path: path || undefined },
      },
    },
  );

  return data ? (
    <RepositoryReadme readme={data} owner={username} slug={repo} />
  ) : null;
}
