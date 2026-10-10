"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Fragment } from "react";
import { toast } from "sonner";

import { revokeAuthorizedApp } from "@/components/oauth-apps/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import type { components } from "@/lib/api/v1";

type AuthorizedApp = components["schemas"]["AuthorizedOauthAppDTO"];

/** Apps holding a token for this account, gh included, each revocable. */
export function AuthorizedAppList({ apps }: { apps: AuthorizedApp[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Authorized apps</h2>
        <p className="text-sm text-muted-foreground">
          Apps you let use your account, and what each may do. Revoke one you
          no longer use; it has to ask again next time.
        </p>
      </div>
      <Card className="py-0">
        {apps.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyTitle>No apps have access</EmptyTitle>
              <EmptyDescription>
                When you approve an app, such as gh, it shows up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {apps.map((app, index) => (
              <Fragment key={app.clientId}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <AuthorizedAppRow app={app} />
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </Card>
    </section>
  );
}

function AuthorizedAppRow({ app }: { app: AuthorizedApp }) {
  const router = useRouter();
  const revoke = useAction(revokeAuthorizedApp, {
    onSuccess: () => {
      toast.success(`${app.name} no longer has access`);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not revoke this app."),
  });

  return (
    <Item className="flex-wrap">
      <ItemMedia>
        <ProfileAvatar
          name={app.name}
          image={app.logoUrl}
          className="size-10 rounded-lg"
        />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle>{app.name}</ItemTitle>
        <div className="flex flex-wrap gap-1">
          {app.scopes.length > 0 ? (
            app.scopes.map((scope) => (
              <Badge key={scope} variant="outline" className="font-mono">
                {scope}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">Public information only</Badge>
          )}
        </div>
        <ItemDescription>
          Approved {new Date(app.authorizedAt).toLocaleDateString()} ·{" "}
          {app.lastUsedAt
            ? `last used ${new Date(app.lastUsedAt).toLocaleDateString()}`
            : "never used"}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline">
              Revoke
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke {app.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                It loses access to your account at once. You can approve it
                again whenever it asks.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogCancel asChild>
                <Button
                  variant="destructive"
                  disabled={revoke.isExecuting}
                  onClick={() => revoke.execute({ clientId: app.clientId })}
                >
                  Revoke access
                </Button>
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  );
}

export function AuthorizedAppListSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 2 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-8 w-16" />
          </li>
        ))}
      </ul>
    </section>
  );
}
