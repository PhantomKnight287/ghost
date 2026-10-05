import { createServerClient } from "@/lib/api/server";

const CODE_SEARCH_PAGE_SIZE = 50;

/** One page of code matches, across public repositories or within `repository`. `nextOffset` is null on the last page. */
export async function searchCode({
  query,
  offset,
  repository,
}: {
  query: string;
  offset: number;
  repository?: { owner: string; slug: string };
}) {
  const client = await createServerClient();
  const page = { q: query, offset, limit: CODE_SEARCH_PAGE_SIZE };
  const result = repository
    ? await client.GET("/api/repositories/{username}/{slug}/search", {
        params: {
          path: { username: repository.owner, slug: repository.slug },
          query: page,
        },
      })
    : await client.GET("/api/search/code", { params: { query: page } });

  return {
    ...result,
    nextOffset: result.data?.hasMore ? offset + CODE_SEARCH_PAGE_SIZE : null,
  };
}
