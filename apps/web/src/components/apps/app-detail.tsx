import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

import { CopyField } from "@/components/copy-field";
import { FormSkeleton } from "@/components/form-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import type { components } from "@/lib/api/v1";

import { AppLogo } from "./app-logo";
import { AppPrivateKeys } from "./app-private-keys";
import { AppSettingsCard } from "./app-settings-card";
import { AppWebhook } from "./app-webhook";
import { DeleteAppCard } from "./delete-app-card";
import { appsPath } from "./paths";

/** One Ghost App: who it is, its keys, how it looks, its settings, its webhook's deliveries, and deleting it. */
export function AppDetail({
  app,
  deliveries,
  organization,
}: {
  app: components["schemas"]["AppDTO"];
  deliveries: components["schemas"]["DeliveryDTO"][];
  organization?: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href={appsPath(organization)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Ghost Apps
        </Link>
        <div className="flex items-center gap-3">
          <ProfileAvatar
            name={app.name}
            image={app.logoUrl}
            className="size-10 rounded-lg"
          />
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-lg font-semibold">{app.name}</h2>
            <Link
              href={`/apps/${app.slug}`}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
            >
              Public page
              <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Identity</h2>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <CopyField
              id="app-id"
              label="App ID"
              value={String(app.appId)}
              description="The JWT's iss, and what Octokit calls appId."
            />
            <CopyField
              id="app-bot"
              label="Bot"
              value={app.botLogin}
              description="Everything the app does shows under this name."
            />
            <CopyField
              id="app-install-url"
              label="Install link"
              value={app.installUrl}
              description="Anyone with this link can install the app on their account or an organization they administer."
            />
          </CardContent>
        </Card>
      </section>
      <AppPrivateKeys app={app} />
      <AppLogo app={app} />
      <AppSettingsCard app={app} />
      <AppWebhook app={app} deliveries={deliveries} />
      <DeleteAppCard app={app} organization={organization} />
    </div>
  );
}

export function AppDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <FormSkeleton fields={3} />
      <FormSkeleton fields={1} />
      <FormSkeleton fields={5} />
    </div>
  );
}
