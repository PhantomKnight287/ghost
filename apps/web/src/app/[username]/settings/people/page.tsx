import { OrganizationPeople } from "@/components/organizations/organization-people";
import { createServerClient } from "@/lib/api/server";

export default async function OrganizationPeoplePage({
  params,
}: PageProps<"/[username]/settings/people">) {
  const { username: slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations");
  const role = data?.organizations.find((org) => org.slug === slug)?.viewerRole;

  return <OrganizationPeople slug={slug} isOwner={role === "owner"} />;
}
