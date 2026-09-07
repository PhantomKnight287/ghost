import { RepositoryContents } from "@/components/repositories/repository-contents";
import { createServerClient } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

import { CloneUrlField } from "./page.client";

export default async function RepositoryPage({
  params,
}: PageProps<"/[username]/[repo]">) {
  const { username, repo } = await params;

  const client = await createServerClient();
  const cloneUrl = `${API_URL}/${username}/${repo}.git`;

  const contents = await client.GET(
    "/api/repositories/{username}/{slug}/contents",
    { params: { path: { username, slug: repo } } },
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Push an existing repository</h2>
        <CloneUrlField cloneUrl={cloneUrl} />
      </div>

      {contents.data ? (
        <RepositoryContents
          contents={contents.data}
          owner={username}
          slug={repo}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Could not load repository files</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Try refreshing the page.
          </p>
        </div>
      )}
    </>
  );
}
