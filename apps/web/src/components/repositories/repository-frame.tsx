"use client";

import {
  BookMarked,
  ChevronRight,
  Code2,
  GitFork,
  GitPullRequest,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
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
  parent,
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
    { value: "code", label: "Code", icon: Code2, href: base },
    {
      value: "pulls",
      label: "Pull requests",
      icon: GitPullRequest,
      href: `${base}/pulls`,
    },
  ];
  const activeTab = view === "pulls" ? "pulls" : "code";

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={viewer ? [viewer] : []} />

      <div className="border-b bg-muted/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 md:px-6">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
              <BookMarked className="size-4.5 text-muted-foreground" />
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="flex items-center gap-1.5 text-lg leading-none">
                  <Link
                    href={`/${username}`}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {username}
                  </Link>
                  <span className="text-muted-foreground/60">/</span>
                  <Link href={base} className="font-semibold hover:underline">
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

            <div className="ml-auto flex shrink-0 gap-2">
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
            {tabs.map(({ value, label, icon: Icon, href }) => (
              <Link
                key={value}
                href={href}
                aria-current={activeTab === value ? "page" : undefined}
                data-active={activeTab === value || undefined}
                className="flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-active:border-foreground data-active:font-medium data-active:text-foreground"
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 md:px-6">
        {activeTab === "code" && rev && (
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={onBranch ? rev : ""}
              onValueChange={(branch) =>
                router.push(`${base}/tree/${encodeURIComponent(branch)}`)
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue
                  placeholder={!onBranch ? rev.slice(0, 7) : "Select a branch"}
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
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
