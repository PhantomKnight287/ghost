import { FileDiffs } from "@/components/diffs/file-diffs";
import { CommitChecks } from "@/components/repositories/commit-checks";
import { CommitHeader } from "@/components/repositories/commit-header";
import { createServerClient, notFoundIfHidden } from "@/lib/api/server";
import { API_URL } from "@/lib/env";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

export default async function RepositoryCommitPage({
  params,
}: PageProps<"/[username]/[repo]/commit/[hash]">) {
  const { username, repo, hash } = await params;

  const client = await createServerClient();

  const commit = await client.GET(
    "/api/repositories/{username}/{slug}/commits/{sha}",
    { params: { path: { username, slug: repo, sha: hash } } },
  );

  notFoundIfHidden(commit.response);
  if (!commit.data) throw new Error(`Failed to read commit ${hash}`);

  return (
    <div className="flex flex-col gap-4">
      <CommitHeader
        commit={commit.data}
        browseHref={`/${username}/${repo}/tree/${commit.data.sha}`}
      />

      <CommitChecks status={commit.data.status} />

      {commit.data.files.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyDescription>
              This commit has no textual changes.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <FileDiffs
          patchUrl={`${API_URL}/api/repositories/${username}/${repo}/commits/${hash}/patch`}
          files={commit.data.files}
        />
      )}
    </div>
  );
}
