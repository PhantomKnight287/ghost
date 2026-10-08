import { BookMarked } from "lucide-react";
import { CursorPagination } from "@/components/cursor-pagination";
import { RepositoryCard } from "@/components/repository-card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { createServerClient } from "@/lib/api/server";

const PAGE_SIZE = 20;

export async function RepositoryResults({
  query,
  cursor,
}: {
  query: string;
  cursor?: string;
}) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/search/repositories", {
    params: { query: { q: query || undefined, cursor, limit: PAGE_SIZE } },
  });
  if (!data) throw new Error(`Failed to search repositories for "${query}"`);

  return (
    <>
      {data.repositories.length > 0 ? (
        <div className="flex flex-col border-t">
          {data.repositories.map((repository) => (
            <RepositoryCard
              key={repository.id}
              showOwner
              repository={{ ...repository, visibility: "public" }}
            />
          ))}
        </div>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookMarked />
            </EmptyMedia>
            <EmptyTitle>No repositories found</EmptyTitle>
            <EmptyDescription>
              {query
                ? `No public repository has “${query}” in its name or description.`
                : "There are no public repositories yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <CursorPagination
        pathname="/search"
        params={{ q: query, type: "repositories" }}
        cursor={cursor}
        nextCursor={data.nextCursor}
      />
    </>
  );
}
