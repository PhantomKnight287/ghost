import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";
import { codeSearchStats, ogCard } from "@/lib/og";

/** The card for a repository's code search, which needs the query an `opengraph-image` never sees. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string; repo: string }> },
) {
  const { username, repo } = await params;
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const client = await createServerClient();

  if (!query) {
    // A private repository answers 404 to the crawler, so nothing leaks here.
    const { data } = await client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    });
    if (!data) notFound();

    return ogCard({
      eyebrow: `${username}/${data.slug}`,
      icon: "search",
      title: "Search code",
      description: `Search the code of ${data.name} on its default branch.`,
    });
  }

  const { data, response } = await client.GET(
    "/api/repositories/{username}/{slug}/search",
    { params: { path: { username, slug: repo }, query: { q: query } } },
  );
  if (response.status === 404) notFound();

  return ogCard({
    eyebrow: `${username}/${repo}`,
    icon: "search",
    badge: { label: "code search" },
    title: `“${query}”`,
    description: `Matches in ${username}/${repo} on its default branch`,
    // a query zoekt rejects, or zoekt being down, still gets a card, just without numbers
    stats: data ? codeSearchStats(data.files) : undefined,
  });
}
