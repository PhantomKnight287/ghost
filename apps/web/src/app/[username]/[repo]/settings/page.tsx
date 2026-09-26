import { notFound } from "next/navigation";

import { RepositoryCollaborators } from "@/components/repositories/repository-collaborators";
import { RepositorySettings } from "@/components/repositories/repository-settings";
import { createServerClient } from "@/lib/api/server";
import { atLeast } from "@/lib/repository-role";

export default async function RepositorySettingsPage({
  params,
}: PageProps<"/[username]/[repo]/settings">) {
  const { username, repo } = await params;
  const client = await createServerClient();
  const path = { username, slug: repo };

  const [repository, branches] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", { params: { path } }),
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path },
    }),
  ]);

  // The API enforces every change; this keeps everyone else from seeing a form they cannot submit.
  const role = repository.data?.viewerRole;
  if (!repository.data || !atLeast(role, "maintain")) notFound();
  const isAdmin = atLeast(role, "admin");

  const collaborators = isAdmin
    ? await client.GET("/api/repositories/{username}/{repo}/collaborators", {
        params: { path: { username, repo } },
      })
    : null;

  return (
    <RepositorySettings
      username={username}
      slug={repository.data.slug}
      name={repository.data.name}
      description={repository.data.description}
      visibility={repository.data.visibility}
      defaultBranch={branches.data?.defaultBranch ?? null}
      branches={branches.data?.branches ?? []}
      isAdmin={isAdmin}
      collaborators={
        collaborators?.data && (
          <RepositoryCollaborators
            username={username}
            slug={repository.data.slug}
            collaborators={collaborators.data.collaborators}
          />
        )
      }
    />
  );
}
