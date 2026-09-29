import { notFound } from "next/navigation";

import { WebhookDetail } from "@/components/repositories/webhook-detail";
import { createServerClient } from "@/lib/api/server";

export default async function WebhookPage({
  params,
}: PageProps<"/[username]/[repo]/settings/webhooks/[webhookId]">) {
  const { username, repo, webhookId } = await params;
  const client = await createServerClient();
  const [webhooks, deliveries] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/webhooks", {
      params: { path: { username, repo } },
    }),
    client.GET(
      "/api/repositories/{username}/{repo}/webhooks/{webhookId}/deliveries",
      {
        params: { path: { username, repo, webhookId } },
      },
    ),
  ]);
  const webhook = webhooks.data?.webhooks.find((w) => w.id === webhookId);
  if (!webhook || !deliveries.data) notFound();

  return (
    <WebhookDetail
      username={username}
      slug={repo}
      webhook={webhook}
      deliveries={deliveries.data.deliveries}
    />
  );
}
