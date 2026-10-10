import { CreateOauthApp } from "@/components/oauth-apps/create-oauth-app";

export default async function NewOrganizationOauthAppPage({
  params,
}: PageProps<"/[username]/settings/oauth-apps/new">) {
  const { username: slug } = await params;
  return <CreateOauthApp organization={slug} />;
}
