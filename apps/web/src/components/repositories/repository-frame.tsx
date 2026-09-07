"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, GitFork } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RepositoryTabs } from "@/app/[username]/[repo]/page.client";
import { StarButton } from "@/components/repositories/star-button";

import type { ReactNode } from "react";

export function RepositoryFrame({
  viewer,
  username,
  slug,
  name,
  description,
  visibility,
  defaultBranch,
  branches,
  starCount,
  viewerHasStarred,
  children,
}: {
  viewer: string;
  username: string;
  slug: string;
  name: string;
  description?: string | null;
  visibility: string;
  defaultBranch: string | null;
  branches?: string[];
  starCount: number;
  viewerHasStarred: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [view, revSegment, ...path] = pathname
    .split("/")
    .slice(3)
    .filter(Boolean)
    .map(decodeURIComponent);

  const hasRev = view === "tree" || view === "blob" || view === "commits";
  const rev = (hasRev && revSegment) || defaultBranch;
  const segments = view === "tree" || view === "blob" ? path : [];

  const treeBase = `/${username}/${slug}/tree/${encodeURIComponent(rev ?? "")}`;

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
            <Link
              href={`/${username}/${slug}`}
              className="font-semibold hover:underline"
            >
              {name}
            </Link>
          </h1>

          <Badge variant="outline" className="rounded-full capitalize">
            {visibility}
          </Badge>

          <div className="ml-auto flex gap-2">
            <StarButton
              username={username}
              slug={slug}
              starCount={starCount}
              viewerHasStarred={viewerHasStarred}
              signedIn={Boolean(viewer)}
            />
            <Button variant="outline" size="sm">
              <GitFork data-icon="inline-start" />
              Fork
            </Button>
          </div>
        </div>

        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}

        <RepositoryTabs
          rev={rev}
          branches={branches}
          code={
            <>
              {rev && (
                <nav className="flex flex-wrap items-center gap-1 text-sm">
                  <Link
                    href={treeBase}
                    className="text-primary hover:underline"
                  >
                    {name}
                  </Link>
                  {segments.map((segment, index) => {
                    const isLast = index === segments.length - 1;
                    const href = `${treeBase}/${segments
                      .slice(0, index + 1)
                      .map(encodeURIComponent)
                      .join("/")}`;

                    return (
                      <span key={href} className="flex items-center gap-1">
                        <span className="text-muted-foreground">/</span>
                        {isLast ? (
                          <span className="font-semibold">{segment}</span>
                        ) : (
                          <Link
                            href={href}
                            className="text-primary hover:underline"
                          >
                            {segment}
                          </Link>
                        )}
                      </span>
                    );
                  })}
                </nav>
              )}

              {children}
            </>
          }
        />
      </main>
    </div>
  );
}
