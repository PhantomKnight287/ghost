import { notFound } from "next/navigation";

import { AppDetail } from "@/components/apps/app-detail";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationAppPage({
  params,
}: PageProps<"/[username]/settings/apps/[slug]">) {
  const { username: organization, slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/apps/{slug}/settings", {
    params: { path: { slug } },
  });
  // Another owner's app never shows under this organization.
  if (
    data?.owner.type !== "organization" ||
    data.owner.login.toLowerCase() !== organization.toLowerCase()
  )
    notFound();

  return <AppDetail app={data} organization={organization} />;
}
