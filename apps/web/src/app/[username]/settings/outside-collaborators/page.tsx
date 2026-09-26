import { notFound } from "next/navigation";

import { OutsideCollaborators } from "@/components/organizations/outside-collaborators";
import { createServerClient } from "@/lib/api/server";

export default async function OutsideCollaboratorsPage({
  params,
}: PageProps<"/[username]/settings/outside-collaborators">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/organizations/{slug}/outside-collaborators",
    { params: { path: { slug } } },
  );
  if (!data) notFound();

  return (
    <OutsideCollaborators slug={slug} collaborators={data.collaborators} />
  );
}
