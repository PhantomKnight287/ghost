import { notFound } from "next/navigation";

import { proxyApiFile } from "@/lib/api/proxy";
import { INTERNAL_API_URL } from "@/lib/env";

/** `/releases/download/<tag>/<name>`, where the tag may itself hold slashes and the name never does. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[username]/[repo]/releases/download/[...path]">,
) {
  const { username, repo, path } = await params;
  const segments = path.map(decodeURIComponent);
  const name = segments.pop();
  if (!name || segments.length === 0) notFound();

  return proxyApiFile(
    new URL(
      `${INTERNAL_API_URL}/api/repositories/${username}/${repo}/releases/tags/${encodeURIComponent(segments.join("/"))}/assets/${encodeURIComponent(name)}`,
    ),
  );
}
