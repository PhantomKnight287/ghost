import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import createFetchClient from "openapi-fetch";

import { authClient } from "@/lib/auth-client";
import { administers } from "@ghost/permissions";
import { unwrap } from "@/lib/api/client";
import { INTERNAL_API_URL } from "@/lib/env";
import { splitRevision } from "@/lib/revision";

import type { paths } from "@/lib/api/v1";

/** What the API needs from the browser's request: its cookies, and the client address the proxy set (x-real-ip on Railway, x-forwarded-for behind Caddy), which Better Auth and code search rate-limit by. */
async function forwardedHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  for (const name of ["cookie", "x-forwarded-for", "x-real-ip"]) {
    const value = incoming.get(name);
    if (value) forwarded[name] = value;
  }
  return forwarded;
}

/** 404s when the API says the resource is absent, or that it is not public and nobody is signed in: a page must not tell an anonymous visitor which private repositories exist. */
export function notFoundIfHidden(response: Response) {
  if (response.status === 404 || response.status === 401) notFound();
}

/** Typed API client for server components. `credentials: "include"` is a browser concept, so the incoming request's cookies are forwarded explicitly. */
export async function createServerClient() {
  return createFetchClient<paths>({
    baseUrl: INTERNAL_API_URL,
    headers: await forwardedHeaders(),
  });
}

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Calls the API as the viewer from a server action and returns its data, throwing the API's error message for next-safe-action to report. */
export async function callApi<T>(
  request: (client: ServerClient) => Promise<{ data?: T; error?: unknown }>,
): Promise<T> {
  return unwrap(request(await createServerClient()));
}

/** The signed-in session, read over INTERNAL_API_URL: in Docker the public API origin can be this container's own localhost. Fetched once per render, however many layouts and pages ask. */
export const getServerSession = cache(
  async (): Promise<typeof authClient.$Infer.Session | null> => {
    const forwarded = await forwardedHeaders();
    if (!forwarded.cookie) return null;

    const res = await fetch(`${INTERNAL_API_URL}/api/auth/get-session`, {
      headers: forwarded,
      cache: "no-store",
    });
    return res.ok ? res.json() : null;
  },
);

/** The signed-in viewer's username, sending anyone signed out to sign in and back to `path`. */
export async function requireViewer(path: string) {
  const username = (await getServerSession())?.user.username;
  if (!username)
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(path)}`);
  return username;
}

/** The viewer's role on a repository, fetched once per render however many components ask. */
export const getViewerRole = cache(async (username: string, slug: string) => {
  const client = await createServerClient();
  const { data } = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug } },
  });
  return data?.viewerRole ?? null;
});

/** The organizations the viewer belongs to, fetched once per render however many components ask. */
const getViewerOrganizations = cache(async () => {
  const client = await createServerClient();
  const { data } = await client.GET("/api/organizations");
  return data?.organizations ?? [];
});

/** Slugs of the organizations the viewer administers, where they may create, fork and transfer repositories to. */
export const getAdminOrganizations = cache(async () =>
  (await getViewerOrganizations())
    .filter((organization) => administers(organization.viewerRole))
    .map((organization) => organization.slug),
);

/** The viewer's role in an organization, or null outside it. */
export async function getOrganizationRole(slug: string) {
  return (
    (await getViewerOrganizations()).find(
      (organization) => organization.slug === slug,
    )?.viewerRole ?? null
  );
}

/** Branch names of a repository, fetched once per render however many components ask. */
export const getBranchNames = cache(async (username: string, slug: string) => {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/branches",
    { params: { path: { username, slug } } },
  );
  return data?.branches ?? [];
});

/** The revision and path a `[ref]/[[...path]]` page names, where a branch like `feat/x` spans more than one segment. Pages get params still encoded; route handlers get them decoded and call `splitRevision` themselves. */
export async function resolveRevisionPath(
  username: string,
  slug: string,
  ref: string,
  path: string[] = [],
) {
  return splitRevision(
    [ref, ...path].map(decodeURIComponent),
    await getBranchNames(username, slug),
  );
}
