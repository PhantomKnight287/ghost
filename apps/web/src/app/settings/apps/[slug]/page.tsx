import { notFound } from "next/navigation";

import { AppDetail } from "@/components/apps/app-detail";
import { createServerClient } from "@/lib/api/server";

export default async function AppPage({
  params,
}: PageProps<"/settings/apps/[slug]">) {
  const { slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/apps/{slug}/settings", {
    params: { path: { slug } },
  });
  // An organization's app is managed under the organization's settings.
  if (!data || data.owner.type !== "user") notFound();

  const deliveries = data.webhookId
    ? ((
        await client.GET("/api/apps/{slug}/webhook/deliveries", {
          params: { path: { slug } },
        })
      ).data?.deliveries ?? [])
    : [];

  return <AppDetail app={data} deliveries={deliveries} />;
}
