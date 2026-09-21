"use client";

import { getAuthRedirectAction } from "@better-auth-ui/core";
import { useAuth, useSession } from "@better-auth-ui/react";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type AuthRedirectProps = {
  className?: string;
};

/** Redirects authenticated users to a validated same-origin target. */
export function AuthRedirect({ className }: AuthRedirectProps) {
  const { authClient, basePaths, viewPaths } = useAuth();
  const { data: session, isPending } = useSession(authClient);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (isPending || hasRedirected.current) return;
    hasRedirected.current = true;

    const action = getAuthRedirectAction(
      new URL(window.location.href),
      Boolean(session),
      `${basePaths.auth}/${viewPaths.auth.signIn}`,
    );

    window.location.replace(action.to);
  }, [basePaths.auth, isPending, session, viewPaths.auth.signIn]);

  return <Spinner className={cn("mx-auto my-auto", className)} />;
}
