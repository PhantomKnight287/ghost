import { notFound } from "next/navigation";

import { RepositorySettings } from "@/components/repositories/repository-settings";
import { createServerClient, getServerSession } from "@/lib/api/server";

export default async function RepositorySettingsPage({
  params,
}: PageProps<"/[username]/[repo]/settings">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  // Only the owner may change settings, and the API enforces it; this keeps everyone else from seeing a form they cannot submit.
  if (session?.user.username !== username) notFound();

  const [repository, branches] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
  ]);

  if (!repository.data) notFound();

  return (
    <RepositorySettings
      username={username}
      slug={repository.data.slug}
      name={repository.data.name}
      description={repository.data.description}
      visibility={repository.data.visibility}
      defaultBranch={branches.data?.defaultBranch ?? null}
      branches={branches.data?.branches ?? []}
    />
  );
}
