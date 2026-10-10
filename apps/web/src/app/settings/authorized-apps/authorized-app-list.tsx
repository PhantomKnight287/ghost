"use client";

import {
  BookLock,
  Building2,
  Globe,
  KeyRound,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Fragment } from "react";
import { toast } from "sonner";

import { revokeAuthorizedApp } from "@/components/oauth-apps/actions";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { describeScope, ScopeGroup } from "@/lib/oauth-scopes";

type AuthorizedApp = components["schemas"]["AuthorizedOauthAppDTO"];

const GROUP_ICONS: Record<ScopeGroup, typeof BookLock> = {
  repo: BookLock,
  org: Building2,
  user: UserRound,
  key: KeyRound,
  delete: Trash2,
  other: Globe,
};

/** Apps holding a token for this account, gh included, each revocable. */
export function AuthorizedAppList({ apps }: { apps: AuthorizedApp[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Authorized apps</h2>
        <p className="text-sm text-muted-foreground">
          Apps you let use your account, and what each may do. Revoke one you no
          longer use; it has to ask again next time.
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
    <Item className="flex-wrap items-start">
      <ItemMedia>
        <ProfileAvatar
          name={app.name}
          image={app.logoUrl}
          className="size-10 rounded-lg"
        />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1">
        <ItemTitle>{app.name}</ItemTitle>
        <ItemDescription>
          Approved {new Date(app.authorizedAt).toLocaleDateString()} ·{" "}
          {app.lastUsedAt
            ? `last used ${new Date(app.lastUsedAt).toLocaleDateString()}`
            : "never used"}
        </ItemDescription>
        <Accordion type="single" collapsible className="mt-1.5">
          <AccordionItem value="permissions">
            <AccordionTrigger className="flex-none items-center justify-start gap-1 py-0.5 font-normal text-muted-foreground hover:text-foreground hover:no-underline **:data-[slot=accordion-trigger-icon]:size-3.5">
              View permissions
            </AccordionTrigger>
            <AccordionContent className="pt-1.5">
              {app.scopes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  It can only see information that is already public.
                </p>
              ) : (
                <ul className="ml-1.5 flex flex-col gap-4 border-l pb-1 pl-4">
                  {app.scopes.map((scope) => {
                    const { title, detail, group } = describeScope(scope);
                    const Icon = GROUP_ICONS[group];
                    return (
                      <li key={scope} className="flex gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon aria-hidden className="size-4" />
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium">{title}</span>
                          <span className="text-sm text-muted-foreground">
                            {detail}
                          </span>
                          <code className="mt-0.5 font-mono text-xs text-muted-foreground/80">
                            {scope}
                          </code>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
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
              <AlertDialogAction
                variant="destructive"
                disabled={revoke.isExecuting}
                onClick={() => revoke.execute({ clientId: app.clientId })}
              >
                Revoke access
              </AlertDialogAction>
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
          <li key={index} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="h-8 w-16" />
          </li>
        ))}
      </ul>
    </section>
  );
}
