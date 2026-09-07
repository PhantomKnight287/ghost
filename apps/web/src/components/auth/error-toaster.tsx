import {
  authMutationKeys,
  authQueryKeys,
  getAuthErrorPresentation,
  isPasswordCompromisedError,
} from "@better-auth-ui/core";
import { oneTapMutationKeys } from "@better-auth-ui/core/plugins/one-tap";
import {
  matchMutation,
  matchQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BetterFetchError } from "better-auth/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { isSessionNotFreshError } from "./is-session-not-fresh-error";

export function ErrorToaster() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const queryCache = queryClient.getQueryCache();
    const previousQueryOnError = queryCache.config.onError;

    queryCache.config.onError = (error, query) => {
      previousQueryOnError?.(error, query);

      if (!matchQuery({ queryKey: authQueryKeys.all }, query)) return;
      if (getAuthErrorPresentation(query.meta) !== "toast") return;
      if (error.name === "SESSION_IS_NOT_FRESH") return;

      const err = error as BetterFetchError;
      if (isSessionNotFreshError(error)) return;
      if (err?.error) toast.error(err.error.message);
    };

    const mutationCache = queryClient.getMutationCache();
    const previousMutationOnError = mutationCache.config.onError;

    mutationCache.config.onError = (
      error,
      variables,
      onMutateResult,
      mutation,
      context,
    ) => {
      previousMutationOnError?.(
        error,
        variables,
        onMutateResult,
        mutation,
        context,
      );

      if (!matchMutation({ mutationKey: authMutationKeys.all }, mutation)) {
        return;
      }
      if (getAuthErrorPresentation(mutation.meta) !== "toast") return;
      if (isSessionNotFreshError(error)) return;
      // Every form that sets a new password renders this one against the
      // password field, so a toast would just repeat it.
      if (isPasswordCompromisedError(error)) return;

      const err = error as BetterFetchError;
      if (
        err.error?.code === "EMAIL_NOT_VERIFIED" &&
        !matchMutation({ mutationKey: oneTapMutationKeys.prompt }, mutation)
      ) {
        return;
      }
      toast.error(err.error?.message || err.message);
    };

    return () => {
      queryCache.config.onError = previousQueryOnError;
      mutationCache.config.onError = previousMutationOnError;
    };
  }, [queryClient]);

  return null;
}
