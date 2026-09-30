import { notFound } from "next/navigation";

import { WebhookList } from "@/components/webhooks/webhook-list";
import { createServerClient } from "@/lib/api/server";

export default async function RepositoryWebhooksPage({
  params,
}: PageProps<"/[username]/[repo]/settings/webhooks">) {
  const { username, repo } = await params;
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/webhooks",
    { params: { path: { username, repo } } },
  );
  // Admins only; the API answers everyone else with 403 or 404.
  if (!data) notFound();
  const owner = { kind: "repository" as const, username, repo };

  return <WebhookList owner={owner} webhooks={data.webhooks} />;
}
