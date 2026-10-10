"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BadgeCheck,
  BookLock,
  Building2,
  ExternalLink,
  Globe,
  KeyRound,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { apiClient, unwrap } from "@/lib/api/client";
import { describeScope, type ScopeGroup } from "@/lib/oauth-scopes";

const GROUP_ICONS: Record<ScopeGroup, typeof BookLock> = {
  repo: BookLock,
  org: Building2,
  user: UserRound,
  key: KeyRound,
  delete: Trash2,
  other: Globe,
};

export type OauthApprovalProps = {
  /** Shown under the app, such as the device flow's user code. */
  details?: ReactNode;
  clientId?: string;
  scopes: string[];
  user: { email: string; name: string; image?: string | null };
  approveLabel: string;
  denyLabel: string;
  isApproving: boolean;
  isDenying: boolean;
  onApprove: () => void;
  onDeny: () => void;
};

/** The card a person approves an OAuth app on, from the device flow or the web flow: who is asking, what it could do, and as whom. */
export function OauthApproval({
  details,
  clientId,
  scopes,
  user,
  approveLabel,
  denyLabel,
  isApproving,
  isDenying,
  onApprove,
  onDeny,
}: OauthApprovalProps) {
  const { data: app, isPending: isAppPending } = useQuery({
    queryKey: ["oauth-apps", "authorize", clientId],
    queryFn: () =>
      unwrap(
        apiClient.GET("/api/oauth-apps/authorize", {
          params: { query: { client_id: clientId ?? "" } },
        }),
      ),
    enabled: Boolean(clientId),
  });
  if (clientId && isAppPending) return <OauthApprovalSkeleton />;

  const name = app?.name ?? "An application";
  const isPending = isApproving || isDenying;
  const homepage = app?.homepageUrl ? new URL(app.homepageUrl) : null;

  return (
    <Card className="w-full max-w-lg gap-0 py-0">
      <CardContent className="flex flex-col items-center gap-4 px-6 pt-8 pb-6 text-center">
        <div className="flex items-center gap-3">
          <div className="relative">
            <ProfileAvatar
              name={name}
              image={app?.logoUrl}
              className="size-14 rounded-xl"
              fallbackClassName="text-lg"
            />
            {app?.verified && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="img"
                      aria-label="Verified"
                      className="absolute -right-1.5 -bottom-1.5 rounded-full bg-card"
                    >
                      <BadgeCheck
                        aria-hidden
                        className="size-6 fill-emerald-500 text-card"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Verified by the operators of this Ghost instance
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <ArrowLeftRight
            aria-hidden
            className="size-4 text-muted-foreground"
          />
          <ProfileAvatar
            name={user.name || user.email}
            image={user.image}
            className="size-14"
            fallbackClassName="text-lg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-balance">
            {name} wants to access your account
          </h1>
          {app && (
            <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{app.owner ? `by @${app.owner}` : "Built into Ghost"}</span>
              {homepage && (
                <>
                  <span aria-hidden>·</span>
                  <a
                    href={homepage.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
                  >
                    {homepage.host}
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        {app?.description && (
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            {app.description}
          </p>
        )}
        {details}
      </CardContent>

      <Separator />

      <CardContent className="flex flex-col gap-3 px-6 py-5">
        <h2 className="text-sm font-medium">
          {scopes.length > 0
            ? `This will let ${name}:`
            : `${name} is asking for no extra access.`}
        </h2>
        {scopes.length > 0 ? (
          <ul className="flex flex-col gap-4">
            {scopes.map((scope) => {
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
        ) : (
          <p className="text-sm text-muted-foreground">
            It can only see information that is already public.
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-4 border-t px-6 py-5">
        <div className="grid w-full grid-cols-2 gap-2">
          <Button
            size="lg"
            variant="outline"
            disabled={isPending}
            onClick={onDeny}
          >
            {isDenying && <Spinner data-icon="inline-start" />}
            {denyLabel}
          </Button>
          <Button size="lg" disabled={isPending} onClick={onApprove}>
            {isApproving && <Spinner data-icon="inline-start" />}
            {approveLabel}
          </Button>
        </div>
        <p className="text-center text-xs text-balance text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">
            {user.name || user.email}
          </span>
          . You can revoke access at any time in{" "}
          <Link
            href="/settings/authorized-apps"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Authorized apps
          </Link>
          .
        </p>
      </CardFooter>
    </Card>
  );
}

/** The card's shape while the app's details load, and while the session does. */
export function OauthApprovalSkeleton() {
  return (
    <Card className="w-full max-w-lg gap-0 py-0">
      <CardContent className="flex flex-col items-center gap-4 px-6 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-14 rounded-xl" />
          <Skeleton className="size-4" />
          <Skeleton className="size-14 rounded-full" />
        </div>
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-40" />
      </CardContent>
      <Separator />
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        <Skeleton className="h-4 w-36" />
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="border-t px-6 py-5">
        <Skeleton className="h-10 w-full" />
      </CardFooter>
    </Card>
  );
}
