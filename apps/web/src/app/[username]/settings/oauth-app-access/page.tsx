import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { OauthAppAccessSettings } from "./oauth-app-access-settings";

export default async function OrganizationOauthAppAccessPage({
  params,
}: PageProps<"/[username]/settings/oauth-app-access">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/organizations/{slug}/oauth-app-access",
    {
      params: { path: { slug } },
    },
  );
  if (!data) notFound();

  return (
    <OauthAppAccessSettings
      slug={slug}
      restricted={data.restricted}
      apps={data.apps}
    />
  );
}
