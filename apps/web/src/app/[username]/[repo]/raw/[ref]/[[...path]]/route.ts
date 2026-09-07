import { headers } from "next/headers";

import { API_URL } from "@/lib/env";

/** Headers the API sets that the browser needs to see unchanged. */
const FORWARDED = [
  "content-type",
  "content-length",
  "content-disposition",
  "x-content-type-options",
  "content-security-policy",
  "cache-control",
  "etag",
];

/**
 * Same-origin proxy for repository file bytes. A cross-origin `<img>` would not
 * carry the session cookie, so a private repository's files would 404.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[username]/[repo]/raw/[ref]/[[...path]]">,
) {
  const { username, repo, ref, path } = await params;

  const url = new URL(`${API_URL}/api/repositories/${username}/${repo}/raw`);
  url.searchParams.set("ref", decodeURIComponent(ref));
  url.searchParams.set("path", (path ?? []).map(decodeURIComponent).join("/"));

  const upstream = await fetch(url, {
    headers: { cookie: (await headers()).get("cookie") ?? "" },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: FORWARDED.flatMap((name) => {
      const value = upstream.headers.get(name);
      return value ? [[name, value] as [string, string]] : [];
    }),
  });
}
