import { notFound } from "next/navigation";

import { CreateWebhookCard } from "@/components/webhooks/create-webhook-card";
import { createServerClient } from "@/lib/api/server";

export default async function NewOrganizationWebhookPage({
  params,
}: PageProps<"/[username]/settings/webhooks/new">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations/{slug}/webhooks", {
    params: { path: { slug } },
  });
  if (!data) notFound();

  return (
    <CreateWebhookCard
      owner={{ kind: "organization", slug }}
      hint="Receives the events of every repository in the organization. Ghost sends a ping right away."
    />
  );
}
