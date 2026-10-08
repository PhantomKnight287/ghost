import { Suspense } from "react";
import { RepositoryContents } from "@/components/repositories/repository-contents";
import { RepositoryEmptyState } from "./repository-empty-state";
import {
  RepositoryReadme,
  RepositoryReadmeSkeleton,
} from "@/components/repositories/repository-readme";
import { createServerClient } from "@/lib/api/server";
import { API_URL, sshCloneUrlFor } from "@/lib/env";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

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
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>Could not load repository files</EmptyTitle>
          <EmptyDescription>Try refreshing the page.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // nothing pushed yet: no tip commit, so there is no tree to list either
  if (contents.data.commit === null) {
    return (
      <RepositoryEmptyState
        cloneUrl={`${API_URL}/${username}/${repo}.git`}
        sshCloneUrl={sshCloneUrlFor(username, repo)}
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
        <RepositoryReadme owner={username} slug={repo} />
      </Suspense>
    </>
  );
}
