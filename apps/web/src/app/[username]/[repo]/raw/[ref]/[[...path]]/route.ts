import { proxyApiFile } from "@/lib/api/proxy";
import { getBranchNames } from "@/lib/api/server";
import { INTERNAL_API_URL } from "@/lib/env";
import { splitRevision } from "@/lib/revision";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/[username]/[repo]/raw/[ref]/[[...path]]">,
) {
  const { username, repo, ref, path } = await params;
  // Route handlers get params already decoded, unlike pages, so `resolveRevisionPath` would decode them twice.
  const resolved = splitRevision(
    [ref, ...(path ?? [])],
    await getBranchNames(username, repo),
  );

  const url = new URL(
    `${INTERNAL_API_URL}/api/repositories/${username}/${repo}/raw`,
  );
  url.searchParams.set("ref", resolved.revision);
  url.searchParams.set("path", resolved.path);

  return proxyApiFile(url);
}
