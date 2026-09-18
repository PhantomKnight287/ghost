import { Suspense } from "react";

import { RepositoryContents } from "@/components/repositories/repository-contents";
import { RepositoryEmptyState } from "@/components/repositories/repository-empty-state";
import {
  RepositoryReadme,
  RepositoryReadmeSkeleton,
} from "@/components/repositories/repository-readme";
import { createServerClient } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

export default async function RepositoryPage({
  params,
}: PageProps<"/[username]/[repo]">) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const contents = await client.GET(
    "/api/repositories/{username}/{slug}/contents",
    { params: { path: { username, slug: repo } } },
  );

  if (!contents.data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">Could not load repository files</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Try refreshing the page.
        </p>
      </div>
    );
  }

  // nothing pushed yet: no tip commit, so there is no tree to list either
  if (contents.data.commit === null) {
    return (
      <RepositoryEmptyState
        cloneUrl={`${API_URL}/${username}/${repo}.git`}
        defaultBranch={
          contents.data.ref.replace(/^refs\/heads\//, "") || "main"
        }
      />
    );
  }

  return (
    <>
      <RepositoryContents
        contents={contents.data}
        owner={username}
        slug={repo}
      />
      <Suspense fallback={<RepositoryReadmeSkeleton />}>
        <Readme username={username} repo={repo} />
      </Suspense>
    </>
  );
}

async function Readme({ username, repo }: { username: string; repo: string }) {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/readme",
    { params: { path: { username, slug: repo } } },
  );

  return data ? (
    <RepositoryReadme readme={data} owner={username} slug={repo} />
  ) : null;
}
