import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked, GitFork, Star } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { RepositoryContents } from "@/components/repositories/repository-contents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createServerClient, getServerSession } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

import { CloneUrlField, RepositoryTabs } from "./page.client";

export default async function RepositoryPage({
  params,
}: PageProps<"/[username]/[repo]">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const viewer = session?.user.username ?? "";
  const cloneUrl = `${API_URL}/${username}/${repo}.git`;

  const repository = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  if (repository.response.status === 404) {
    notFound();
  }

  if (repository.error || !repository.data) {
    throw new Error(`Failed to load ${username}/${repo}`);
  }

  const [contents,branches] = await Promise.all([
    client.GET(
      "/api/repositories/{username}/{slug}/contents",
      { params: { path: { username, slug: repo } } },
    ),
    client.GET('/api/repositories/{username}/{slug}/branches',{params:{path:{username,slug:repo}}}),]
  )


  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <BookMarked className="size-5 text-muted-foreground" />

          <h1 className="flex items-center gap-1 text-xl">
            <Link
              href={`/${username}`}
              className="text-primary hover:underline"
            >
              {username}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-semibold">{repository.data.name}</span>
          </h1>

          <Badge variant="outline" className="rounded-full capitalize">
            {repository.data.visibility}
          </Badge>

          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm">
              <Star data-icon="inline-start" />
              Star
            </Button>
            <Button variant="outline" size="sm">
              <GitFork data-icon="inline-start" />
              Fork
            </Button>
          </div>
        </div>

        {repository.data.description && (
          <p className="text-sm text-muted-foreground">
            {repository.data.description}
          </p>
        )}

        <RepositoryTabs
          defaultBranch={branches.data?.defaultBranch ?? null}
          branches={branches.data?.branches}
          code={
            <>
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">
                  Push an existing repository
                </h2>
                <CloneUrlField cloneUrl={cloneUrl} />
              </div>

              {contents.data ? (
                <RepositoryContents
                  contents={contents.data}
                  owner={username}
                  slug={repository.data.slug}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
                  <p className="text-sm font-medium">
                    Could not load repository files
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Try refreshing the page.
                  </p>
                </div>
              )}
            </>
          }
        />
      </main>
    </div>
  );
}
