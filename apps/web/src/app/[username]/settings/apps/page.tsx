import { notFound } from "next/navigation";

import { AppList } from "@/components/apps/app-list";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationAppsPage({
  params,
}: PageProps<"/[username]/settings/apps">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/apps", {
    params: { path: { slug } },
  });
  if (!data) notFound();

  return <AppList apps={data.apps} organization={slug} />;
}
