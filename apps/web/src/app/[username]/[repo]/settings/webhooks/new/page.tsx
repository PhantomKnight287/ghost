import { notFound } from "next/navigation";

import { CreateWebhookCard } from "@/components/webhooks/create-webhook-card";
import { createServerClient } from "@/lib/api/server";

export default async function NewRepositoryWebhookPage({
  params,
}: PageProps<"/[username]/[repo]/settings/webhooks/new">) {
  const { username, repo } = await params;
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/webhooks",
    { params: { path: { username, repo } } },
  );
  // Admins only; the API answers everyone else with 403 or 404.
  if (!data) notFound();

  return (
    <CreateWebhookCard
      owner={{ kind: "repository", username, repo }}
      hint="Ghost sends a ping right away, so you can check the URL works."
    />
  );
}
