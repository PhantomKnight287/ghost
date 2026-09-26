import { notFound } from "next/navigation";

import { OrganizationGeneral } from "@/components/organizations/organization-general";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationGeneralPage({
  params,
}: PageProps<"/[username]/settings">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const [profile, mine, settings, repositories] = await Promise.all([
    client.GET("/api/organizations/{slug}", { params: { path: { slug } } }),
    client.GET("/api/organizations"),
    client.GET("/api/organizations/{slug}/settings", {
      params: { path: { slug } },
    }),
    // ponytail: the first 100 only; an organization with more deletes the rest before it can go.
    client.GET("/api/repositories/{username}", {
      params: { path: { username: slug }, query: { limit: 100 } },
    }),
  ]);
  if (!profile.data || !settings.data) notFound();
  const role = mine.data?.organizations.find(
    (org) => org.slug === slug,
  )?.viewerRole;

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
