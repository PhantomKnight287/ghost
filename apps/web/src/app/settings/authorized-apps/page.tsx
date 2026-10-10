import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { AuthorizedAppList } from "./authorized-app-list";

export default async function AuthorizedAppsPage() {
  const client = await createServerClient();
  const { data } = await client.GET("/api/oauth-apps/authorized");
  if (!data) notFound();

  return <AuthorizedAppList apps={data.apps} />;
}
