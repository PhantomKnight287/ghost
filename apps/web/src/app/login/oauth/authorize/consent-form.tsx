"use client";

import { useSession } from "@better-auth-ui/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  OauthApproval,
  OauthApprovalSkeleton,
} from "@/components/auth/oauth-approval/oauth-approval";
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

  if (!session) return <OauthApprovalSkeleton />;

  return (
    <OauthApproval
      clientId={clientId}
      scopes={scope.split(" ").filter((each) => each && each !== NO_SCOPE)}
      user={session.user}
      approveLabel="Authorize"
      denyLabel="Cancel"
      isApproving={decide.isPending && decide.variables}
      isDenying={decide.isPending && !decide.variables}
      onApprove={() => decide.mutate(true)}
      onDeny={() => decide.mutate(false)}
    />
  );
}
