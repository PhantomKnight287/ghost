import { proxy as trackAgents } from "@databuddy/sdk/agents";
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";

import { matchPage } from "@/lib/agent-pages";
import { PATH_HEADER } from "@/lib/canonical-path";

/** Serves a public page as Markdown to an agent that asks for it with `Accept: text/markdown`, and counts agent visits. */
export function proxy(request: NextRequest, event: NextFetchEvent) {
  trackAgents(request, event);

  const { pathname } = request.nextUrl;
  if (
    request.method === "GET" &&
    // No browser sends text/markdown, so its presence alone decides.
    request.headers.get("accept")?.includes("text/markdown") &&
    matchPage(pathname.split("/").filter(Boolean))
  ) {
    return NextResponse.rewrite(
      new URL(`/api/markdown${pathname}`, request.url),
    );
  }

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}
