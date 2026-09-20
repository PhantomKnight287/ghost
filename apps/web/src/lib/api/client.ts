import createFetchClient from "openapi-fetch";
import type { paths } from "@/lib/api/v1";
import { API_URL } from "@/lib/env";

/**
 * Typed API client for client components. Unlike the server one, the browser
 * carries the session cookie itself - it only has to be asked to.
 */
export const apiClient = createFetchClient<paths>({
  baseUrl: API_URL,
  credentials: "include",
});

/** The message the API's error filter returns, or a status-code fallback. */
export function apiErrorMessage(
  error: unknown,
  fallback = "Something went wrong",
) {
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : fallback;
}
