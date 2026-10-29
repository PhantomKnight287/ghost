import { notFound } from "next/navigation";

import { InstallationList } from "@/components/installations/installation-list";
import { createServerClient } from "@/lib/api/server";

export default async function InstallationsPage() {
  const client = await createServerClient();
  const { data } = await client.GET("/api/installations");
  if (!data) notFound();

  return <InstallationList installations={data.installations} />;
}
