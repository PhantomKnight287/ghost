import { proxyApiFile } from "@/lib/api/proxy";
import { INTERNAL_API_URL } from "@/lib/env";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/[username]/[repo]/raw/[ref]/[[...path]]">,
) {
  const { username, repo, ref, path } = await params;

  const url = new URL(
    `${INTERNAL_API_URL}/api/repositories/${username}/${repo}/raw`,
  );
  url.searchParams.set("ref", decodeURIComponent(ref));
  url.searchParams.set("path", (path ?? []).map(decodeURIComponent).join("/"));

  return proxyApiFile(url);
}
