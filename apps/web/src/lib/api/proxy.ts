import { headers } from "next/headers";

/** Headers the API sets on file bytes that the browser needs to see unchanged. */
const FORWARDED = [
  "content-type",
  "content-length",
  "content-disposition",
  "x-content-type-options",
  "content-security-policy",
  "cache-control",
  "etag",
];

/** Streams an API response for file bytes back from this origin. A cross-origin `<img>` or download link would not carry the session cookie, so a private repository's files would 404. */
export async function proxyApiFile(url: URL) {
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
