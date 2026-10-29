import { notFound } from "next/navigation";

import { accountRepositories } from "@/components/installations/account-repositories";
import { InstallationDetail } from "@/components/installations/installation-detail";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationInstallationPage({
  params,
}: PageProps<"/[username]/settings/installations/[id]">) {
  const { username: slug, id } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/installations", {
    params: { path: { slug } },
  });
  const installation = data?.installations.find((row) => row.id === id);
  if (!installation) notFound();

  return (
    <InstallationDetail
      installation={installation}
      repositories={await accountRepositories(slug)}
      organization={slug}
    />
  );
}
