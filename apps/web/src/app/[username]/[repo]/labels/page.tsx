import { notFound } from "next/navigation";

import { LabelManager } from "@/components/issues/label-manager";
import { createServerClient, getViewerRole } from "@/lib/api/server";
import { atLeast } from "@/lib/repository-role";

export default async function LabelsPage({
  params,
}: PageProps<"/[username]/[repo]/labels">) {
  const { username, repo } = await params;

  const [role, client] = await Promise.all([
    getViewerRole(username, repo),
    createServerClient(),
  ]);

  const labels = await client.GET(
    "/api/repositories/{username}/{repo}/labels",
    { params: { path: { username, repo } } },
  );

  if (labels.response.status === 404) notFound();
  if (!labels.data) {
    throw new Error(`Failed to list labels of ${username}/${repo}`);
  }

  return (
    <LabelManager
      username={username}
      repo={repo}
      labels={labels.data.labels}
      canEdit={atLeast(role, "write")}
    />
  );
}
