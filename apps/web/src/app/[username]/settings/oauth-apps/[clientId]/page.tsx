import { notFound } from "next/navigation";

import { OauthAppDetail } from "@/components/oauth-apps/oauth-app-detail";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationOauthAppPage({
  params,
}: PageProps<"/[username]/settings/oauth-apps/[clientId]">) {
  const { username: slug, clientId } = await params;
  const client = await createServerClient();
  // Read from the organization's list, so another owner's app never shows under this organization.
  const { data } = await client.GET("/api/organizations/{slug}/oauth-apps", {
    params: { path: { slug } },
  });
  const app = data?.apps.find((each) => each.clientId === clientId);
  if (!app) notFound();

  return <OauthAppDetail app={app} organization={slug} />;
}
