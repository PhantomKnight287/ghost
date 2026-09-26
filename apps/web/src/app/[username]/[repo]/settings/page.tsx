import { notFound } from "next/navigation";

import { RepositoryGeneralSettings } from "@/components/repositories/repository-settings";
import {
  createServerClient,
  getAdminOrganizations,
  getServerSession,
} from "@/lib/api/server";
import { atLeast } from "@ghost/permissions";

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
      transferTargets={
        atLeast(repository.data.viewerRole, "owner")
          ? await transferTargets(username)
          : []
      }
      canTransfer={atLeast(repository.data.viewerRole, "owner")}
    />
  );
}

/** The viewer's own account and the organizations they administer, less the current owner. */
async function transferTargets(currentOwner: string) {
  const [session, organizations] = await Promise.all([
    getServerSession(),
    getAdminOrganizations(),
  ]);
  return [session?.user.username, ...organizations].filter(
    (owner): owner is string => Boolean(owner) && owner !== currentOwner,
  );
}
