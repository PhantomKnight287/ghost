import type { Metadata } from "next";
import { BookMarked, Code2, Search } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { CursorPagination } from "@/components/cursor-pagination";
import { RepositoryCard } from "@/components/repository-card";
import { TabLink } from "@/components/tab-link";
import { CodeSearchResults } from "@/components/search/code-search-results";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { createServerClient, getServerSession } from "@/lib/api/server";

const PAGE_SIZE = 20;

type Kind = "repositories" | "code";

export async function generateMetadata({
  searchParams,
}: PageProps<"/search">): Promise<Metadata> {
  const { q, type } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const title = query ? `Search · ${query}` : "Search";
  const image = `/search/og?${new URLSearchParams({
    q: query,
    type: type === "code" ? "code" : "repositories",
  })}`;

  return {
    title,
    openGraph: { title, images: [image] },
    twitter: { images: [image] },
  };
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const { q, type, cursor } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const kind: Kind = type === "code" ? "code" : "repositories";
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const session = await getServerSession();
  const viewer = session?.user.username ?? "";

  const hrefFor = (target: Kind, next?: string) =>
    `/search?${new URLSearchParams({
      q: query,
      type: target,
      ...(next && { cursor: next }),
    })}`;

  const tabs = [
    { value: "repositories", label: "Repositories", icon: BookMarked },
    { value: "code", label: "Code", icon: Code2 },
  ] as const;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <nav className="flex gap-1 border-b">
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabLink key={value} href={hrefFor(value)} active={kind === value}>
              <Icon className="size-4" />
              {label}
            </TabLink>
          ))}
        </nav>

        {kind === "code" ? (
          <CodeResults query={query} />
        ) : (
          <RepositoryResults
            query={query}
            cursor={pageCursor}
            hrefFor={(next) => hrefFor("repositories", next)}
          />
        )}
      </main>
    </div>
  );
}

async function RepositoryResults({
  query,
  cursor,
  hrefFor,
}: {
  query: string;
  cursor?: string;
  hrefFor: (cursor?: string) => string;
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
              repository={{
                name: repository.name,
                slug: repository.slug,
                owner: repository.owner,
                description: repository.description ?? undefined,
                visibility: "public",
                updatedAt: repository.lastPushedAt,
              }}
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
        firstHref={hrefFor()}
        nextHref={data.nextCursor ? hrefFor(data.nextCursor) : null}
        isFirstPage={!cursor}
      />
    </>
  );
}

async function CodeResults({ query }: { query: string }) {
  if (!query) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search />
          </EmptyMedia>
          <EmptyTitle>Search code</EmptyTitle>
          <EmptyDescription>
            Type in the search bar to search the code of public repositories.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const client = await createServerClient();
  const { data, error } = await client.GET("/api/search/code", {
    params: { query: { q: query } },
  });

  return <CodeSearchResults files={data?.files ?? []} error={error?.message} />;
}
