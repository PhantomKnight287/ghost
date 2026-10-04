import { proxyApiFile } from "@/lib/api/proxy";
import { resolveRevisionPath } from "@/lib/api/server";
import { INTERNAL_API_URL } from "@/lib/env";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/[username]/[repo]/raw/[ref]/[[...path]]">,
) {
  const { username, repo, ref, path } = await params;
  const resolved = await resolveRevisionPath(username, repo, ref, path);

  const url = new URL(
    `${INTERNAL_API_URL}/api/repositories/${username}/${repo}/raw`,
  );
  url.searchParams.set("ref", resolved.revision);
  url.searchParams.set("path", resolved.path);

  return proxyApiFile(url);
}
