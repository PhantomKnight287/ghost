import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { FormSkeleton } from "@/components/form-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import type { components } from "@/lib/api/v1";

import { DeleteOauthAppCard } from "./delete-oauth-app-card";
import { OauthAppCredentials } from "./oauth-app-credentials";
import { OauthAppLogo } from "./oauth-app-logo";
import { OauthAppSettingsCard } from "./oauth-app-settings-card";
import { oauthAppsPath } from "./paths";

/** One OAuth app: what it needs to connect, how it looks to people, its settings, and deleting it. */
export function OauthAppDetail({
  app,
  organization,
}: {
  app: components["schemas"]["OauthAppDTO"];
  organization?: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href={oauthAppsPath(organization)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          OAuth apps
        </Link>
        <div className="flex items-center gap-3">
          <ProfileAvatar
            name={app.name}
            image={app.logoUrl}
            className="size-10 rounded-lg"
          />
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-lg font-semibold">{app.name}</h2>
            <a
              href={app.homepageUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm text-muted-foreground hover:underline"
            >
              {app.homepageUrl}
            </a>
          </div>
        </div>
      </div>
      <OauthAppCredentials app={app} />
      <OauthAppLogo app={app} />
      <OauthAppSettingsCard app={app} />
      <DeleteOauthAppCard app={app} organization={organization} />
    </div>
  );
}

export function OauthAppDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <FormSkeleton fields={2} />
      <FormSkeleton fields={4} />
    </div>
  );
}
