import { GitCommitHorizontal } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FileDiffs } from "@/components/diffs/file-diffs";
import { FromNowHoverCard } from "@/components/from-now-card";
import { createServerClient } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

export default async function RepositoryCommitPage({
  params,
}: PageProps<"/[username]/[repo]/commit/[hash]">) {
  const { username, repo, hash } = await params;

  const client = await createServerClient();

  const commit = await client.GET(
    "/api/repositories/{username}/{slug}/commits/{sha}",
    { params: { path: { username, slug: repo, sha: hash } } },
  );

  if (commit.response.status === 404) notFound();
  if (!commit.data) throw new Error(`Failed to read commit ${hash}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
          <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{commit.data.subject}</span>
          <Link
            href={`/${username}/${repo}/tree/${commit.data.sha}`}
            className="ml-auto shrink-0 text-xs text-muted-foreground hover:underline"
          >
            Browse files at {commit.data.sha.slice(0, 7)}
          </Link>
        </div>

        <div className="px-4 py-2.5 text-xs text-muted-foreground">
          {commit.data.authorName} committed{" "}
          <FromNowHoverCard date={commit.data.committedAt} />
          {" · "}
          {commit.data.files.length} changed file
          {commit.data.files.length === 1 ? "" : "s"}
        </div>

        {commit.data.body && (
          <pre className="border-t px-4 py-2.5 text-xs whitespace-pre-wrap">
            {commit.data.body}
          </pre>
        )}
      </div>

      {commit.data.files.length === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          This commit has no textual changes.
        </p>
      ) : (
        <FileDiffs
          patchUrl={`${API_URL}/api/repositories/${username}/${repo}/commits/${hash}/patch`}
          files={commit.data.files}
        />
      )}
    </div>
  );
}
