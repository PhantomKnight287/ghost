import { headers } from "next/headers";

import { fetchApi, forwardedHeaders } from "@/lib/api/server";

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
  // A revalidation passes through, so a browser holding the file gets a 304 rather than the bytes again.
  const ifNoneMatch = (await headers()).get("if-none-match");
  const upstream = await fetchApi(url, {
    headers: {
      ...(await forwardedHeaders()),
      ...(ifNoneMatch && { "if-none-match": ifNoneMatch }),
    },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: FORWARDED.flatMap((name) => {
      const value = upstream.headers.get(name);
      return value ? [[name, value] as [string, string]] : [];
    }),
  });
}
