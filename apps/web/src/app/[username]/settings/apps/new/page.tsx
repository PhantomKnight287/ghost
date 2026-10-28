import { CreateApp } from "@/components/apps/create-app";

export default async function NewOrganizationAppPage({
  params,
}: PageProps<"/[username]/settings/apps/new">) {
  const { username: slug } = await params;
  return <CreateApp organization={slug} />;
}
