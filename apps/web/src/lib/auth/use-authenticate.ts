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
 * `useSession` keeps serving the last cached value while a refetch is in
 * flight, so a `null` left over from a signed-out visit still reads as
 * "no session" right after signing in. Sign-in invalidates the session query,
 * but invalidation only refetches *active* queries and nothing on the sign-in
 * page subscribes to it - the fresh session lands one tick after the guarded
 * page mounts. Redirecting on that stale `null` sends the user straight back
 * to sign-in, which is the redirect loop. Treat an in-flight fetch as
 * undecided.
 */
export function shouldRedirectToSignIn(session: {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
}) {
  return !session.data && !session.isPending && !session.isFetching;
}

/**
 * `useSession` plus a redirect to sign-in for unauthenticated visitors, with
 * the current URL preserved as `redirectTo`.
 *
 * Drop-in replacement for `@better-auth-ui/react`'s `useAuthenticate`, which
 * redirects on a stale session value.
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
