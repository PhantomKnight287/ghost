import { CreateWebhookCard } from "@/components/webhooks/create-webhook-card";

export default async function NewOrganizationWebhookPage({
  params,
}: PageProps<"/[username]/settings/webhooks/new">) {
  const { username: slug } = await params;

  return (
    <CreateWebhookCard
      owner={{ kind: "organization", slug }}
      hint="Receives the events of every repository in the organization. Ghost sends a ping right away."
    />
  );
}
