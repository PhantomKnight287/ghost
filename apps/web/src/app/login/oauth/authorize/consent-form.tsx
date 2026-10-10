"use client";

import { useSession } from "@better-auth-ui/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { OauthApproval } from "@/components/auth/oauth-approval/oauth-approval";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

/** What the API asks the oauth-provider plugin for when an app requests no scope, since the plugin reads an empty request as every scope. */
const NO_SCOPE = "public";

/** Approve or deny an app's request. The plugin checks the signed query it put in this page's URL, so the decision carries it back verbatim. */
export function ConsentForm({
  clientId,
  scope,
}: {
  clientId: string;
  scope: string;
}) {
  const { data: session } = useSession(authClient);
  const decide = useMutation({
    mutationFn: async (accept: boolean) => {
      const { data, error } = await authClient.$fetch<{ url: string }>(
        "/oauth2/consent",
        {
          method: "POST",
          body: { accept, oauth_query: window.location.search.slice(1) },
        },
      );
      if (error) throw new Error(error.message ?? "Authorization failed");
      return data.url;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => toast.error(error.message),
  });

  if (!session) return <ConsentFormSkeleton />;

  return (
    <OauthApproval
      className="w-full max-w-sm"
      title="Authorize application"
      description="An application is asking to act on your account."
      clientId={clientId}
      scopes={scope.split(" ").filter((each) => each && each !== NO_SCOPE)}
      user={session.user}
      signedInAsLabel="Signed in as"
      approveLabel="Authorize"
      denyLabel="Cancel"
      isApproving={decide.isPending && decide.variables}
      isDenying={decide.isPending && !decide.variables}
      onApprove={() => decide.mutate(true)}
      onDeny={() => decide.mutate(false)}
    />
  );
}

function ConsentFormSkeleton() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-48 w-full" />
      </CardContent>
    </Card>
  );
}
