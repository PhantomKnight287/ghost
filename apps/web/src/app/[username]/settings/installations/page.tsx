import { notFound } from "next/navigation";

import { InstallationList } from "@/components/installations/installation-list";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationInstallationsPage({
  params,
}: PageProps<"/[username]/settings/installations">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/installations", {
    params: { path: { slug } },
  });
  if (!data) notFound();

  return (
    <InstallationList installations={data.installations} organization={slug} />
  );
}
