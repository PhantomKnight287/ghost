import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoaderCircle, Search } from "lucide-react";

import { CodeSearchResults } from "@/components/search/code-search-results";
import { SearchForm } from "@/components/search/search-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { searchCode } from "@/lib/api/code-search";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/search">): Promise<Metadata> {
  const [{ username, repo }, { q }] = await Promise.all([params, searchParams]);
  const query = typeof q === "string" ? q.trim() : "";
  const title = `${query ? `${query} · ` : ""}${username}/${repo}`;
  const image = `/${username}/${repo}/search/og?${new URLSearchParams({ q: query })}`;

  return {
    title,
    openGraph: { title, images: [image] },
    twitter: { images: [image] },
  };
}

export default async function RepositorySearchPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/search">) {
  const [{ username, repo }, { q }] = await Promise.all([params, searchParams]);
  const query = typeof q === "string" ? q.trim() : "";

  const searchForm = (
    <SearchForm
      action={`/${username}/${repo}/search`}
      placeholder="Search this repository"
      query={query}
      autoFocus={!query}
    />
  );

  if (!query) {
    return (
      <div className="flex flex-col gap-4">
        {searchForm}
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>Search this repository</EmptyTitle>
            <EmptyDescription>
              Type in the search bar above to search the code on the default
              branch.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const repository = { owner: username, slug: repo };
  const { data, error, response } = await searchCode({ query, repository });
  if (response.status === 404) notFound();

  return (
    <div className="flex flex-col gap-4">
      {searchForm}
      {data && "indexing" in data && data.indexing && (
        <Alert>
          <LoaderCircle className="animate-spin" />
          <AlertDescription>
            The latest commits are being indexed. Results may be missing them
            for a few seconds.
          </AlertDescription>
        </Alert>
      )}
      <CodeSearchResults
        query={query}
        files={data?.files ?? []}
        nextCursor={data?.nextCursor ?? null}
        repository={repository}
        error={error?.message}
      />
    </div>
  );
}
