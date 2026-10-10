import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { OauthAppList } from "./oauth-app-list";

export default async function OauthAppsPage() {
  const client = await createServerClient();
  const { data } = await client.GET("/api/oauth-apps");
  if (!data) notFound();

  return <OauthAppList apps={data.apps} />;
}
