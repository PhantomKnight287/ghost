import { notFound } from "next/navigation";

import { proxyApiFile } from "@/lib/api/proxy";
import { INTERNAL_API_URL } from "@/lib/env";

/** `/archive/<ref>.zip` or `.tar.gz`, as on GitHub; the ref may hold slashes, encoded or not. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[username]/[repo]/archive/[...ref]">,
) {
  const { username, repo, ref } = await params;
  // Route handlers get params already decoded.
  const [, revision, format] =
    ref.join("/").match(/^(.+)\.(zip|tar\.gz)$/) ?? [];
  if (!revision || !format) notFound();

  const url = new URL(
    `${INTERNAL_API_URL}/api/repositories/${username}/${repo}/archive`,
  );
  url.searchParams.set("ref", revision);
  url.searchParams.set("format", format);
  return proxyApiFile(url);
}
