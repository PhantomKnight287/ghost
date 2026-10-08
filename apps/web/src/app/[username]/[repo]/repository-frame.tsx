"use client";

import {
  BookMarked,
  ChevronRight,
  CircleDot,
  Code2,
  GitBranch,
  GitFork,
  GitPullRequest,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { AppHeader } from "@/components/app-header";
import { WatchButton } from "@/components/notifications/watch-button";
import { TabLink } from "@/components/tab-link";
import { BranchSelect } from "@/components/repositories/branch-select";
import { ClonePopover } from "@/components/repositories/clone-popover";
import { StarButton } from "@/components/repositories/star-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { API_URL, sshCloneUrlFor } from "@/lib/env";
import { splitRevision } from "@/lib/revision";
import { cn } from "@/lib/utils";
import { atLeast } from "@ghost/permissions";
import type { RepositoryFrameProps } from "@/types/repository";

import { FileFinder } from "./file-finder";
import { FileTree } from "./file-tree";
import { FILE_TREE_COLLAPSED_COOKIE } from "./file-tree-cookie";

// pages under the code tab that are not a view of the tree, and so have no branch to pick
const OWN_HEADER_VIEWS = new Set(["search", "releases", "tags", "branches"]);

export function RepositoryFrame({
  viewer,
  viewerRole,
  username,
  slug,
  name,
  description,
  visibility,
  defaultBranch,
  branches,
  starCount,
  viewerHasStarred,
  watchLevel,
  forkCount,
  openPullRequestCount,
  openIssueCount,
  parent,
  fileTreeCollapsed,
  sidebar,
  children,
}: RepositoryFrameProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, ...rest] = pathname
    .split("/")
    .slice(3)
    .filter(Boolean)
    .map(decodeURIComponent);

  const hasRev = view === "tree" || view === "blob" || view === "commits";
  const { revision, path } = splitRevision(hasRev ? rest : [], branches ?? []);
  const rev = revision || defaultBranch;
  const segments =
    (view === "tree" || view === "blob") && path ? path.split("/") : [];
  const onBranch = rev != null && (branches ?? []).includes(rev);

  const base = `/${username}/${slug}`;
  const treeBase = `${base}/tree/${encodeURIComponent(rev ?? "")}`;

  const tabs = [
    { value: "code", label: "Code", icon: Code2, href: base, count: null },
    {
      value: "issues",
      label: "Issues",
      icon: CircleDot,
      href: `${base}/issues`,
      count: openIssueCount ?? null,
    },
    {
      value: "pulls",
      label: "Pull requests",
      icon: GitPullRequest,
      href: `${base}/pulls`,
      count: openPullRequestCount ?? null,
    },
    ...(atLeast(viewerRole, "maintain")
      ? [
          {
            value: "settings",
            label: "Settings",
            icon: Settings,
            href: `${base}/settings`,
            count: null,
          },
        ]
      : []),
  ];
  const activeTab =
    view === "pulls" || view === "issues" || view === "settings"
      ? view
      : "code";
  // the root of the repository only: a file or a subdirectory has nothing to say about the repository as a whole
  const showSidebar = activeTab === "code" && view === undefined;
  const showTree = view === "blob" && rev != null;
  const [treeCollapsed, setTreeCollapsed] = useState(fileTreeCollapsed);
  // a narrow screen has no room beside the file, so there the tree waits behind its toggle
  const [treeShown, setTreeShown] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} repository={{ owner: username, slug }} />

      <div className="border-b bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 md:px-6">
          {/* On a phone this is one column: the icon stays beside the name, and the actions get a full-width row under the description. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                <BookMarked className="size-4.5 text-muted-foreground" />
              </div>

              {/* at least as tall as the icon and centred on it, so the name alone, or the name with its fork line, lines up with it */}
              <div className="flex min-h-9 min-w-0 flex-col justify-center gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="flex min-w-0 flex-wrap items-center gap-1.5 text-lg leading-none">
                    <Link
                      href={`/${username}`}
                      className="truncate text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {username}
                    </Link>
                    <span className="text-muted-foreground/60">/</span>
                    <Link
                      href={base}
                      className="truncate font-semibold hover:underline"
                    >
                      {name}
                    </Link>
                  </h1>

                  <Badge variant="outline" className="capitalize">
                    {visibility}
                  </Badge>
                </div>

                {parent && (
                  <p className="text-xs text-muted-foreground">
                    forked from{" "}
                    <Link
                      href={`/${parent.username}/${parent.slug}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {parent.username}/{parent.name}
                    </Link>
                  </p>
                )}

                {description && (
                  <p className="max-w-2xl text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-2 sm:ml-auto">
              {watchLevel && (
                <WatchButton
                  username={username}
                  repo={slug}
                  level={watchLevel}
                />
              )}
              <StarButton
                username={username}
                slug={slug}
                starCount={starCount}
                viewerHasStarred={viewerHasStarred}
                signedIn={Boolean(viewer)}
              />
              <Button variant="outline" size="sm" asChild>
                <Link href={`${base}/fork`}>
                  <GitFork data-icon="inline-start" />
                  Fork
                  <span className="ml-1 text-muted-foreground tabular-nums">
                    {forkCount}
                  </span>
                </Link>
              </Button>
            </div>
          </div>

          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {tabs.map(({ value, label, icon: Icon, href, count }) => (
              <TabLink key={value} href={href} active={activeTab === value}>
                <Icon className="size-4" />
                {label}
                {count !== null && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                    {count}
                  </span>
                )}
              </TabLink>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {activeTab === "code" && !OWN_HEADER_VIEWS.has(view) && rev && (
              // one row on a phone too: the select gives way first, and the count drops its word
              <div className="flex items-center gap-3">
                <BranchSelect
                  branches={branches ?? []}
                  value={onBranch ? rev : ""}
                  onValueChange={(branch) =>
                    router.push(`${base}/tree/${encodeURIComponent(branch)}`)
                  }
                  placeholder={
                    // a sha is shortened; a tag reads in full
                    /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev
                  }
                  className="w-[180px] min-w-0 shrink"
                />
                <Link
                  href={`${base}/branches`}
                  className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  <GitBranch className="size-4" />
                  <span className="font-medium tabular-nums">
                    {branches?.length ?? 0}
                  </span>
                  <span className="max-sm:sr-only">
                    {branches?.length === 1 ? "branch" : "branches"}
                  </span>
                </Link>
                <div className="ml-auto flex items-center gap-2">
                  <FileFinder
                    base={base}
                    username={username}
                    slug={slug}
                    revision={rev}
                  />
                  <ClonePopover
                    cloneUrl={`${API_URL}/${username}/${slug}.git`}
                    sshCloneUrl={sshCloneUrlFor(username, slug)}
                  />
                </div>
              </div>
            )}
            {segments.length > 0 && (
              <nav className="flex flex-wrap items-center gap-1 text-sm">
                {showTree && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={treeShown ? "Hide files" : "Show files"}
                      aria-expanded={treeShown}
                      onClick={() => setTreeShown(!treeShown)}
                      className="lg:hidden"
                    >
                      {treeShown ? <PanelLeftClose /> : <PanelLeftOpen />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={treeCollapsed ? "Show files" : "Hide files"}
                      aria-expanded={!treeCollapsed}
                      onClick={() => {
                        setTreeCollapsed(!treeCollapsed);
                        document.cookie = `${FILE_TREE_COLLAPSED_COOKIE}=${treeCollapsed ? 0 : 1}; path=/; max-age=31536000; samesite=lax`;
                      }}
                      className="max-lg:hidden"
                    >
                      {treeCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                    </Button>
                  </>
                )}
                <Link href={treeBase} className="text-primary hover:underline">
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
                      <ChevronRight className="size-3.5 text-muted-foreground" />
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

            {showTree ? (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <aside
                  className={cn(
                    "max-h-96 shrink-0 overflow-y-auto rounded-lg border [scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:var(--border)_transparent] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-64",
                    !treeShown && "max-lg:hidden",
                    treeCollapsed && "lg:hidden",
                  )}
                >
                  <FileTree
                    base={base}
                    username={username}
                    slug={slug}
                    revision={rev}
                    current={path}
                  />
                </aside>
                <div className="min-w-0 flex-1">{children}</div>
              </div>
            ) : (
              children
            )}
          </div>

          {sidebar && showSidebar ? (
            <aside className="flex w-full flex-col gap-6 lg:w-72 lg:shrink-0">
              {sidebar}
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
