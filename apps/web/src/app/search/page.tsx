import type { Metadata } from "next";
import { BookMarked, Code2 } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { TabLink } from "@/components/tab-link";
import { SearchForm } from "@/components/search/search-form";
import { getServerSession } from "@/lib/api/server";
import { RepositoryResults } from "./repository-results";
import { CodeResults } from "./code-results";

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

  const tabs = [
    { value: "repositories", label: "Repositories", icon: BookMarked },
    { value: "code", label: "Code", icon: Code2 },
  ] as const;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <SearchForm
          action="/search"
          placeholder="Search Ghost"
          query={query}
          type={kind}
          autoFocus={!query}
        />

        <nav className="flex gap-1 border-b">
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabLink
              key={value}
              href={`/search?${new URLSearchParams({ q: query, type: value })}`}
              active={kind === value}
            >
              <Icon className="size-4" />
              {label}
            </TabLink>
          ))}
        </nav>

        {kind === "code" ? (
          <CodeResults query={query} />
        ) : (
          <RepositoryResults query={query} cursor={pageCursor} />
        )}
      </main>
    </div>
  );
}
