import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { RepositoryContents } from "@/components/repositories/repository-contents";
import { Badge } from "@/components/ui/badge";
import { createServerClient, getServerSession } from "@/lib/api/server";

import { RepositoryTabs } from "../../../page.client";

export default async function RepositoryTreePage({
  params,
}: PageProps<"/[username]/[repo]/tree/[branch]/[[...path]]">) {
  const { username, repo, branch, path } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const viewer = session?.user.username ?? "";
  const branchName = decodeURIComponent(branch);
  const segments = (path ?? []).map(decodeURIComponent);
  const treePath = segments.join("/");

  const repository = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  if (repository.response.status === 404) {
    notFound();
  }

  if (repository.error || !repository.data) {
    throw new Error(`Failed to load ${username}/${repo}`);
  }

  const [contents, branches] = await Promise.all([
    client.GET("/api/repositories/{username}/{slug}/contents", {
      params: {
        path: { username, slug: repo },
        query: { branch: branchName, path: treePath || undefined },
      },
    }),
    client.GET("/api/repositories/{username}/{slug}/branches", {
      params: { path: { username, slug: repo } },
    }),
  ]);

  if (contents.response.status === 404) {
    notFound();
  }

  const treeBase = `/${username}/${repo}/tree/${encodeURIComponent(branchName)}`;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <BookMarked className="size-5 text-muted-foreground" />

          <h1 className="flex items-center gap-1 text-xl">
            <Link href={`/${username}`} className="text-primary hover:underline">
              {username}
            </Link>
            <span className="text-muted-foreground">/</span>
            <Link
              href={`/${username}/${repo}`}
              className="font-semibold hover:underline"
            >
              {repository.data.name}
            </Link>
          </h1>

          <Badge variant="outline" className="rounded-full capitalize">
            {repository.data.visibility}
          </Badge>
        </div>

        <RepositoryTabs
          defaultBranch={branchName}
          branches={branches.data?.branches}
          code={
            <>
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                <Link href={treeBase} className="text-primary hover:underline">
                  {repository.data.name}
                </Link>
                {segments.map((segment, index) => {
                  const href = `${treeBase}/${segments
                    .slice(0, index + 1)
                    .map(encodeURIComponent)
                    .join("/")}`;
                  const isLast = index === segments.length - 1;

                  return (
                    <span key={href} className="flex items-center gap-1">
                      <span className="text-muted-foreground">/</span>
                      {isLast ? (
                        <span className="font-semibold">{segment}</span>
                      ) : (
                        <Link href={href} className="text-primary hover:underline">
                          {segment}
                        </Link>
                      )}
                    </span>
                  );
                })}
              </nav>

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
