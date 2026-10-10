"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, unwrap } from "@/lib/api/client";

export type OauthApprovalProps = {
  className?: string;
  title: string;
  description: string;
  /** Shown above the app, such as the device flow's user code. */
  details?: ReactNode;
  clientId?: string;
  scopes: string[];
  user: { email: string; name: string };
  signedInAsLabel: string;
  approveLabel: string;
  denyLabel: string;
  isApproving: boolean;
  isDenying: boolean;
  onApprove: () => void;
  onDeny: () => void;
};

/** The card a user approves an OAuth app on, from the device flow or the web flow: who is asking, for what, and as whom. */
export function OauthApproval({
  className,
  title,
  description,
  details,
  clientId,
  scopes,
  user,
  signedInAsLabel,
  approveLabel,
  denyLabel,
  isApproving,
  isDenying,
  onApprove,
  onDeny,
}: OauthApprovalProps) {
  const isPending = isApproving || isDenying;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/50 p-3">
          {details ? (
            <>
              {details}
              <Separator />
            </>
          ) : null}

          {clientId ? (
            <>
              <OauthAppSummary clientId={clientId} />
              <Separator />
            </>
          ) : null}

          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Requested scopes</p>
            {scopes.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {scopes.map((scope) => (
                  <li
                    key={scope}
                    className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs"
                  >
                    {scope}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">None: public information only</p>
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{signedInAsLabel}</p>
            <p className="text-sm font-medium">{user.name || user.email}</p>
            {user.name ? (
              <p className="text-xs text-muted-foreground">{user.email}</p>
            ) : null}
          </div>
        </div>
      </CardContent>

      <CardFooter className="grid grid-cols-2 gap-2">
        <Button disabled={isPending} variant="outline" onClick={onDeny}>
          {isDenying ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <XIcon data-icon="inline-start" />
          )}
          {denyLabel}
        </Button>

        <Button disabled={isPending} onClick={onApprove}>
          {isApproving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          {approveLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

function OauthAppSummary({ clientId }: { clientId: string }) {
  const { data: app, isPending } = useQuery({
    queryKey: ["oauth-apps", "authorize", clientId],
    queryFn: () =>
      unwrap(
        apiClient.GET("/api/oauth-apps/authorize", {
          params: { query: { client_id: clientId } },
        }),
      ),
  });

  if (isPending) return <OauthAppSummarySkeleton />;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">Application</p>
      <p className="text-sm font-medium">{app?.name ?? clientId}</p>
      {app?.homepageUrl ? (
        <a
          className="truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
          href={app.homepageUrl}
          rel="noreferrer"
          target="_blank"
        >
          {app.homepageUrl}
        </a>
      ) : null}
      {app ? (
        <p className="text-xs text-muted-foreground">
          {app.owner ? `Registered by @${app.owner}` : "Built into Ghost"}
        </p>
      ) : null}
    </div>
  );
}

function OauthAppSummarySkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">Application</p>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}
