import { headers } from "next/headers";
import createFetchClient from "openapi-fetch";

import { authClient } from "@/lib/auth-client";
import { INTERNAL_API_URL } from "@/lib/env";

import type { paths } from "@/lib/api/v1";

async function forwardedCookie() {
  return (await headers()).get("cookie") ?? "";
}

/**
 * Typed API client for server components. `credentials: "include"` is a browser
 * concept, so the incoming request's cookies are forwarded explicitly.
 */
export async function createServerClient() {
  const cookie = await forwardedCookie();

  return createFetchClient<paths>({
    baseUrl: INTERNAL_API_URL,
    headers: cookie ? { cookie } : undefined,
  });
}

export async function getServerSession() {
  const cookie = await forwardedCookie();
  if (!cookie) return null;

  const { data } = await authClient.getSession({
    fetchOptions: { headers: { cookie }, baseURL: INTERNAL_API_URL },
  });

  return data;
}
