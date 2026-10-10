import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { OauthAppDetail } from "./oauth-app-detail";

export default async function OauthAppPage({
  params,
}: PageProps<"/settings/oauth-apps/[clientId]">) {
  const { clientId } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/oauth-apps/{clientId}", {
    params: { path: { clientId } },
  });
  if (!data) notFound();

  return <OauthAppDetail app={data} />;
}
