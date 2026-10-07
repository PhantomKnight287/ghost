import type { Metadata } from "next";
import { Suspense } from "react";

import { RepositoryContents } from "@/components/repositories/repository-contents";
import {
  RepositoryReadme,
  RepositoryReadmeSkeleton,
} from "@/components/repositories/repository-readme";
import {
  createServerClient,
  notFoundIfHidden,
  resolveRevisionPath,
} from "@/lib/api/server";
import { ogUrl } from "@/lib/og-url";

export async function generateMetadata({
  params,
}: PageProps<"/[username]/[repo]/tree/[ref]/[[...path]]">): Promise<Metadata> {
  const { username, repo, ref, path } = await params;
  const { revision, path: dirPath } = await resolveRevisionPath(
    username,
    repo,
    ref,
    path,
  );

  const location = dirPath ? `${dirPath} at ` : "";
  const title = `${username}/${repo} · ${location}${revision}`;
  const image = ogUrl({ username, repo, ref: revision, path: dirPath });

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

  const [client, { revision, path: dirPath }] = await Promise.all([
    createServerClient(),
    resolveRevisionPath(username, repo, ref, path),
  ]);

  const contents = await client.GET(
    "/api/repositories/{username}/{slug}/contents",
    {
      params: {
        path: { username, slug: repo },
        query: { ref: revision, path: dirPath || undefined },
      },
    },
  );

  notFoundIfHidden(contents.response);
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
          path={dirPath}
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
