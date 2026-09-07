import { notFound } from "next/navigation";

import { RepositoryContents } from "@/components/repositories/repository-contents";
import { createServerClient } from "@/lib/api/server";

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
    <RepositoryContents contents={contents.data} owner={username} slug={repo} />
  );
}
