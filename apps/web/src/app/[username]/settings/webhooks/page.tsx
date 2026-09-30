import { notFound } from "next/navigation";

import { WebhookList } from "@/components/webhooks/webhook-list";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationWebhooksPage({
  params,
}: PageProps<"/[username]/settings/webhooks">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/webhooks", {
    params: { path: { slug } },
  });
  if (!data) notFound();
  const owner = { kind: "organization" as const, slug };

  return <WebhookList owner={owner} webhooks={data.webhooks} />;
}
