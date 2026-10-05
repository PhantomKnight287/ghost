import { createServerClient } from "@/lib/api/server";

const CODE_SEARCH_PAGE_SIZE = 20;

/** One page of code matches, across public repositories or within `repository`. */
export async function searchCode({
  query,
  cursor,
  repository,
}: {
  query: string;
  cursor?: string;
  repository?: { owner: string; slug: string };
}) {
  const client = await createServerClient();
  const page = { q: query, cursor, limit: CODE_SEARCH_PAGE_SIZE };
  return repository
    ? client.GET("/api/repositories/{username}/{slug}/search", {
        params: {
          path: { username: repository.owner, slug: repository.slug },
          query: page,
        },
      })
    : client.GET("/api/search/code", { params: { query: page } });
}
