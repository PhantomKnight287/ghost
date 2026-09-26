import { notFound } from "next/navigation";

import { RepositoryCollaborators } from "@/components/repositories/repository-collaborators";
import { createServerClient } from "@/lib/api/server";

export default async function RepositoryCollaboratorsPage({
  params,
}: PageProps<"/[username]/[repo]/settings/collaborators">) {
  const { username, repo } = await params;
  const client = await createServerClient();

  const collaborators = await client.GET(
    "/api/repositories/{username}/{repo}/collaborators",
    { params: { path: { username, repo } } },
  );
  // Admins only; the API answers everyone else with 403 or 404.
  if (!collaborators.data) notFound();

  return (
    <RepositoryCollaborators
      username={username}
      slug={repo}
      collaborators={collaborators.data.collaborators}
    />
  );
}
