import { Search } from "lucide-react";
import { CodeSearchResults } from "@/components/search/code-search-results";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { searchCode } from "@/lib/api/code-search";

export async function CodeResults({ query }: { query: string }) {
  if (!query) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search />
          </EmptyMedia>
          <EmptyTitle>Search code</EmptyTitle>
          <EmptyDescription>
            Type in the search bar above to search the code of public
            repositories.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const { data, error } = await searchCode({ query });

  return (
    <CodeSearchResults
      query={query}
      files={data?.files ?? []}
      nextCursor={data?.nextCursor ?? null}
      error={error?.message}
    />
  );
}
