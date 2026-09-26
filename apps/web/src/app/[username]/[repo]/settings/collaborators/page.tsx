import { notFound } from "next/navigation";

import { RepositoryCollaborators } from "@/components/repositories/repository-collaborators";
import { RepositoryTeams } from "@/components/repositories/repository-teams";
import { createServerClient } from "@/lib/api/server";

export default async function RepositoryCollaboratorsPage({
  params,
}: PageProps<"/[username]/[repo]/settings/collaborators">) {
  const { username, repo } = await params;
  const client = await createServerClient();
  const path = { username, repo };

  const [collaborators, teams] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/collaborators", {
      params: { path },
    }),
    // Answers 400 for a user's own repository, which has no teams to share with.
    client.GET("/api/repositories/{username}/{repo}/teams", {
      params: { path },
    }),
  ]);
  // Admins only; the API answers everyone else with 403 or 404.
  if (!collaborators.data) notFound();

  return (
    <div className="flex flex-col gap-8">
      {teams.data && (
        <RepositoryTeams
          username={username}
          slug={repo}
          teams={teams.data.teams}
        />
      )}
      <RepositoryCollaborators
        username={username}
        slug={repo}
        collaborators={collaborators.data.collaborators}
      />
    </div>
  );
}
