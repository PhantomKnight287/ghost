import { notFound } from "next/navigation";

import { RepositoryGeneralSettings } from "@/components/repositories/repository-settings";
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
  if (!repository.data) notFound();

  return (
    <RepositoryGeneralSettings
      // Remount after a save so each card starts from what was stored.
      key={repository.data.updatedAt}
      username={username}
      slug={repository.data.slug}
      name={repository.data.name}
      description={repository.data.description}
      visibility={repository.data.visibility}
      defaultBranch={branches.data?.defaultBranch ?? null}
      branches={branches.data?.branches ?? []}
      isAdmin={atLeast(repository.data.viewerRole, "admin")}
    />
  );
}
