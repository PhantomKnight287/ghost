"use client";

import type { AuthClient } from "@better-auth-ui/core";
import {
  useAuth,
  useSession,
  type UseSessionOptions,
} from "@better-auth-ui/react";
import { useEffect } from "react";

/**
 * Whether an unauthenticated visitor should be bounced to sign-in.
 *
 * `useSession` serves the stale `null` from a signed-out visit while the refetch is in flight, and redirecting on it loops straight back to sign-in. An in-flight fetch is undecided.
 */
export function shouldRedirectToSignIn(session: {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
}) {
  return !session.data && !session.isPending && !session.isFetching;
}

/**
 * `useSession` plus a redirect to sign-in for unauthenticated visitors, with the current URL preserved as `redirectTo`.
 *
 * Drop-in replacement for `@better-auth-ui/react`'s `useAuthenticate`, which redirects on a stale session value.
 */
export function useAuthenticate<TAuthClient extends AuthClient>(
  authClient: TAuthClient,
  options?: UseSessionOptions<TAuthClient>,
) {
  const { basePaths, viewPaths, navigate } = useAuth();
  const session = useSession(authClient, options);
  const { data, isPending, isFetching } = session;

  useEffect(() => {
    if (!shouldRedirectToSignIn({ data, isPending, isFetching })) return;

    const currentURL = window.location.pathname + window.location.search;
    const redirectTo = encodeURIComponent(currentURL);

    navigate({
      to: `${basePaths.auth}/${viewPaths.auth.signIn}?redirectTo=${redirectTo}`,
      replace: true,
    });
  }, [
    basePaths.auth,
    data,
    isFetching,
    isPending,
    navigate,
    viewPaths.auth.signIn,
  ]);

  return session;
}
