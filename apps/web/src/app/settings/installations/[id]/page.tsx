import { notFound } from "next/navigation";

import { accountRepositories } from "@/components/installations/account-repositories";
import { InstallationDetail } from "@/components/installations/installation-detail";
import { createServerClient } from "@/lib/api/server";

export default async function InstallationPage({
  params,
}: PageProps<"/settings/installations/[id]">) {
  const { id } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/api/installations");
  const installation = data?.installations.find((row) => row.id === id);
  if (!installation) notFound();

  return (
    <InstallationDetail
      installation={installation}
      repositories={await accountRepositories(installation.account.login)}
    />
  );
}
