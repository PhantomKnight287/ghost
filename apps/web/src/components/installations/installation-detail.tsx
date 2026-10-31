import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import type { components } from "@/lib/api/v1";

import { ConfigureRepositories } from "./configure-installation";
import { InstallationActions } from "./installation-actions";
import { PendingPermissions } from "./pending-permissions";
import { PermissionSummary } from "./permission-summary";

/** One installation as its account manages it: what it may do, where, and the switches that stop it. */
export function InstallationDetail({
  installation,
  repositories,
  organization,
}: {
  installation: components["schemas"]["InstallationDTO"];
  repositories: { id: string; fullName: string }[];
  organization?: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar
          name={installation.app.name}
          image={installation.app.logoUrl}
          className="size-12 rounded-xl"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Link
              href={`/apps/${installation.app.slug}`}
              className="hover:underline"
            >
              {installation.app.name}
            </Link>
            {installation.suspendedAt && (
              <Badge variant="secondary">Suspended</Badge>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Installed on {installation.account.login}
          </p>
        </div>
        <InstallationActions
          installation={installation}
          organization={organization}
        />
      </div>
      {installation.pending && (
        <PendingPermissions
          installation={installation}
          pending={installation.pending}
        />
      )}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Permissions</h2>
        <Card className="px-6">
          <PermissionSummary permissions={installation.permissions} />
        </Card>
      </section>
      <ConfigureRepositories
        installation={installation}
        repositories={repositories}
      />
    </div>
  );
}

export function InstallationDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
