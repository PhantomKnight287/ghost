import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { accountRepositories } from "@/components/installations/account-repositories";
import { InstallForm } from "@/components/installations/install-form";
import { PermissionSummary } from "@/components/installations/permission-summary";
import { Card } from "@/components/ui/card";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import {
  createServerClient,
  getAdminOrganizations,
  requireViewer,
} from "@/lib/api/server";

export const metadata: Metadata = { title: "Install app" };

/** Installs an app on the viewer's account or an organization they administer. */
export default async function InstallAppPage({
  params,
}: PageProps<"/apps/[slug]/installations/new">) {
  const { slug } = await params;
  const viewer = await requireViewer(`/apps/${slug}/installations/new`);
  const client = await createServerClient();
  const [{ data: app }, organizations, mine] = await Promise.all([
    client.GET("/api/apps/{slug}", { params: { path: { slug } } }),
    getAdminOrganizations(),
    client.GET("/api/installations"),
  ]);
  if (!app) notFound();
  const installedOn = async (login: string, organization: boolean) =>
    (organization
      ? (
          await client.GET("/api/organizations/{slug}/installations", {
            params: { path: { slug: login } },
          })
        ).data?.installations
      : mine.data?.installations
    )?.find((installation) => installation.app.slug === slug)?.id ?? null;
  const accounts = await Promise.all(
    [
      { login: viewer, organization: false },
      ...organizations.map((login) => ({ login, organization: true })),
    ].map(async (account) => ({
      ...account,
      repositories: await accountRepositories(account.login),
      installationId: await installedOn(account.login, account.organization),
    })),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
      <div className="flex items-center gap-4">
        <ProfileAvatar
          name={app.name}
          image={app.logoUrl}
          className="size-14 rounded-xl"
        />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Install {app.name}</h1>
          <p className="text-sm text-muted-foreground">By {app.owner.login}</p>
        </div>
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">It will be able to</h2>
        <Card className="px-6">
          <PermissionSummary permissions={app.permissions} />
        </Card>
      </section>
      <InstallForm slug={slug} accounts={accounts} />
    </main>
  );
}
