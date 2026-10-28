import { notFound } from "next/navigation";

import { AppList } from "@/components/apps/app-list";
import { createServerClient } from "@/lib/api/server";

export default async function AppsPage() {
  const client = await createServerClient();
  const { data } = await client.GET("/api/apps");
  if (!data) notFound();

  return <AppList apps={data.apps} />;
}
