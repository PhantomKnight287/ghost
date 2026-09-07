import { BetterFetchError } from "better-auth/react";

export function isSessionNotFreshError(error: BetterFetchError | Error | null) {
  return error?.name === "SESSION_IS_NOT_FRESH";
}
