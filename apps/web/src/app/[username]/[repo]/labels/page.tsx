import { notFound } from "next/navigation";

import { LabelManager } from "@/components/issues/label-manager";
import { createServerClient, getServerSession } from "@/lib/api/server";

export default async function LabelsPage({
  params,
}: PageProps<"/[username]/[repo]/labels">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
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
      canEdit={session?.user.username === username}
    />
  );
}
