import { notFound } from "next/navigation";

import { WebhookDetail } from "@/components/webhooks/webhook-detail";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationWebhookPage({
  params,
}: PageProps<"/[username]/settings/webhooks/[webhookId]">) {
  const { username: slug, webhookId } = await params;
  const client = await createServerClient();
  const [webhooks, deliveries] = await Promise.all([
    client.GET("/api/organizations/{slug}/webhooks", {
      params: { path: { slug } },
    }),
    client.GET("/api/organizations/{slug}/webhooks/{webhookId}/deliveries", {
      params: { path: { slug, webhookId } },
    }),
  ]);
  const webhook = webhooks.data?.webhooks.find(({ id }) => id === webhookId);
  if (!webhook || !deliveries.data) notFound();

  return (
    <WebhookDetail
      owner={{ kind: "organization", slug }}
      webhook={webhook}
      deliveries={deliveries.data.deliveries}
    />
  );
}
