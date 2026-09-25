import { createServerClient } from "@/lib/api/server";
import { codeSearchStats, ogCard, plural } from "@/lib/og";

const REPOSITORY_PAGE = 20;

/** The card for `/search`. An `opengraph-image` never sees search params, so the page points its metadata here with the query attached. */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const query = search.get("q")?.trim() ?? "";
  const kind = search.get("type") === "code" ? "code" : "repositories";

  if (!query) {
    return ogCard({
      eyebrow: "Search",
      icon: "search",
      title: "Search Ghost",
      description: "Find public repositories and the code inside them.",
    });
  }

  const client = await createServerClient();

  if (kind === "code") {
    const { data } = await client.GET("/api/search/code", {
      params: { query: { q: query } },
    });

    return ogCard({
      eyebrow: "Code search",
      icon: "code",
      badge: { label: "code" },
      title: `“${query}”`,
      description: "Matches in public code on Ghost",
      stats: codeSearchStats(data?.files ?? []),
    });
  }

  const { data } = await client.GET("/api/search/repositories", {
    params: { query: { q: query, limit: REPOSITORY_PAGE } },
  });
  const found = data?.repositories.length ?? 0;

  return ogCard({
    eyebrow: "Repository search",
    icon: "search",
    badge: { label: "repositories" },
    title: `“${query}”`,
    description:
      "Public repositories on Ghost whose name or description matches",
    stats: [
      {
        icon: "bookMarked",
        // one page is all the card fetches, so a full page is a lower bound
        label: data?.hasMore
          ? `${found}+ repositories`
          : plural(found, "repository", "repositories"),
      },
    ],
  });
}
