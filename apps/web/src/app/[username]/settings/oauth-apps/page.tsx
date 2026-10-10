import { notFound } from "next/navigation";

import { OauthAppList } from "@/components/oauth-apps/oauth-app-list";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationOauthAppsPage({
  params,
}: PageProps<"/[username]/settings/oauth-apps">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/oauth-apps", {
    params: { path: { slug } },
  });
  if (!data) notFound();

  return <OauthAppList apps={data.apps} organization={slug} />;
}
