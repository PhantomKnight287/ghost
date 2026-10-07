import { notFound } from "next/navigation";

import { OrganizationGeneral } from "./organization-general";
import { createServerClient, getOrganizationRole } from "@/lib/api/server";

export default async function OrganizationGeneralPage({
  params,
}: PageProps<"/[username]/settings">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const [profile, role, settings, repositories] = await Promise.all([
    client.GET("/api/organizations/{slug}", { params: { path: { slug } } }),
    getOrganizationRole(slug),
    client.GET("/api/organizations/{slug}/settings", {
      params: { path: { slug } },
    }),
    // ponytail: the first 100 only; an organization with more deletes the rest before it can go.
    client.GET("/api/repositories/{username}", {
      params: { path: { username: slug }, query: { limit: 100 } },
    }),
  ]);
  if (!profile.data || !settings.data) notFound();

  return (
    <OrganizationGeneral
      slug={slug}
      name={profile.data.name}
      isOwner={role === "owner"}
      settings={settings.data}
      repositories={(repositories.data?.repositories ?? []).map(
        (repository) => repository.slug,
      )}
      pinned={profile.data.pinned.map((repository) => repository.slug)}
    />
  );
}
