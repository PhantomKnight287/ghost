import { OrganizationPeople } from "./organization-people";
import { getOrganizationRole } from "@/lib/api/server";

export default async function OrganizationPeoplePage({
  params,
}: PageProps<"/[username]/settings/people">) {
  const { username: slug } = await params;
  const role = await getOrganizationRole(slug);

  return <OrganizationPeople slug={slug} isOwner={role === "owner"} />;
}
