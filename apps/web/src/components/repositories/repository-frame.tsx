"use client";

import {
  BookMarked,
  ChevronRight,
  CircleDot,
  Code2,
  GitFork,
  GitPullRequest,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { TabLink } from "@/components/tab-link";
import {
  ClonePopover,
  sshCloneUrlFor,
} from "@/components/repositories/clone-popover";
import { StarButton } from "@/components/repositories/star-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { API_URL } from "@/lib/env";
import type { RepositoryFrameProps } from "@/types/repository";

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
  forkCount,
  openPullRequestCount,
  openIssueCount,
  parent,
  sidebar,
  children,
}: RepositoryFrameProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, revSegment, ...path] = pathname
    .split("/")
    .slice(3)
    .filter(Boolean)
    .map(decodeURIComponent);

  const hasRev = view === "tree" || view === "blob" || view === "commits";
  const rev = (hasRev && revSegment) || defaultBranch;
  const segments = view === "tree" || view === "blob" ? path : [];
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
  ];
  const activeTab =
    view === "pulls" ? "pulls" : view === "issues" ? "issues" : "code";
  // the root of the repository only: a file or a subdirectory has nothing to say about the repository as a whole
  const showSidebar = activeTab === "code" && view === undefined;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader
        username={viewer}
        owners={viewer ? [viewer] : []}
        repository={{ owner: username, slug }}
      />

      <div className="border-b bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 md:px-6">
          {/* on a phone this is one column: the icon stays beside the name
              rather than stranded on a line of its own, and the actions get a
              full-width row under the description */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                <BookMarked className="size-4.5 text-muted-foreground" />
              </div>

              <div className="flex min-w-0 flex-col gap-1">
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
            {activeTab === "code" && view !== "search" && rev && (
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={onBranch ? rev : ""}
                  onValueChange={(branch) =>
                    router.push(`${base}/tree/${encodeURIComponent(branch)}`)
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue
                      placeholder={
                        !onBranch ? rev.slice(0, 7) : "Select a branch"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(branches ?? []).map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="ml-auto flex items-center gap-2">
                  <ClonePopover
                    cloneUrl={`${API_URL}/${username}/${slug}.git`}
                    sshCloneUrl={sshCloneUrlFor(username, slug)}
                  />
                </div>
              </div>
            )}
            {segments.length > 0 && (
              <nav className="flex flex-wrap items-center gap-1 text-sm">
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

            {children}
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
