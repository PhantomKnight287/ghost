import { OrganizationTeams } from "@/components/organizations/organization-teams";

export default async function OrganizationTeamsPage({
  params,
}: PageProps<"/[username]/settings/teams">) {
  const { username: slug } = await params;
  return <OrganizationTeams slug={slug} />;
}
