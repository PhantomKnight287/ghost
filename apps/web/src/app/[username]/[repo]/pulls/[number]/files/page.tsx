import { notFound } from "next/navigation";

import { DiffView } from "@/components/pull-requests/diff-view";
import { createServerClient } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

export default async function PullRequestFilesPage({
  params,
}: PageProps<"/[username]/[repo]/pulls/[number]/files">) {
  const { username, repo, number } = await params;

  const client = await createServerClient();
  const summary = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}/files",
    { params: { path: { username, repo, number: Number(number) } } },
  );

  if (summary.response.status === 404) notFound();
  if (!summary.data) {
    throw new Error(`Failed to read the diff of pull request #${number}`);
  }

  return (
    <DiffView
      from={summary.data.from}
      to={summary.data.to}
      files={summary.data.files}
      patchUrl={`${API_URL}/api/repositories/${username}/${repo}/pulls/${number}/patch`}
    />
  );
}
