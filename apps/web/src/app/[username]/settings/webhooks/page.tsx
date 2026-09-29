import { notFound } from "next/navigation";

import { CreateWebhookCard } from "@/components/webhooks/create-webhook-card";
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

  return (
    <div className="flex flex-col gap-8">
      <CreateWebhookCard
        owner={owner}
        hint="Receives the events of every repository in the organization. Ghost sends a ping right away."
      />
      <WebhookList owner={owner} webhooks={data.webhooks} />
    </div>
  );
}
