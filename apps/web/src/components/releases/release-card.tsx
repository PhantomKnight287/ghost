import {
  Download,
  FileArchive,
  GitCommitHorizontal,
  type LucideIcon,
  Package,
  Pencil,
  Tag,
} from "lucide-react";
import Link from "next/link";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";
import type { Release } from "@/types/release";

import { releasePath } from "./common";
import { DeleteReleaseButton } from "./delete-release-button";

export function ReleaseCard({
  username,
  repo,
  release,
}: {
  username: string;
  repo: string;
  release: Release;
}) {
  const date = release.publishedAt ?? release.createdAt;

  return (
    <article className="flex flex-col gap-4 rounded-lg border p-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-xl font-semibold">
              <Link
                href={releasePath(username, repo, release.tagName)}
                className="hover:underline"
              >
                {release.name ?? release.tagName}
              </Link>
            </h2>
            {release.isLatest && <Badge>Latest</Badge>}
            {release.isPrerelease && (
              <Badge variant="outline">Pre-release</Badge>
            )}
            {release.isDraft && <Badge variant="secondary">Draft</Badge>}
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Tag className="size-3.5" />
              {release.tagName}
            </span>
            {release.commitSha ? (
              <Link
                href={`/${username}/${repo}/commit/${release.commitSha}`}
                className="flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <GitCommitHorizontal className="size-3.5" />
                <code>{release.commitSha.slice(0, 7)}</code>
              </Link>
            ) : (
              <span>tag deleted</span>
            )}
            <span>
              {release.authorUsername ?? "Someone"}{" "}
              {release.isDraft ? "drafted this" : "released this"}{" "}
              <FromNowHoverCard date={date} />
            </span>
          </p>
        </div>

        {release.viewerCanEdit && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={releasePath(username, repo, release.tagName, "edit")}>
                <Pencil data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            <DeleteReleaseButton
              username={username}
              repo={repo}
              id={release.id}
              title={release.name ?? release.tagName}
            />
          </div>
        )}
      </header>

      {release.body ? (
        <Markdown repository={{ username, repo }}>{release.body}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">No release notes.</p>
      )}

      {(release.assets.length > 0 || release.source) && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            Assets
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
              {release.assets.length + (release.source ? 2 : 0)}
            </span>
          </h3>
          <ul className="divide-y rounded-lg border">
            {release.assets.map((asset) => (
              <ReleaseFile
                key={asset.id}
                icon={Package}
                href={`${releasePath(username, repo, release.tagName, "download")}/${encodeURIComponent(asset.name)}`}
                name={asset.name}
                size={asset.size}
                downloadCount={asset.downloadCount}
              />
            ))}
            {/* a tag that is gone has no source to archive */}
            {release.source &&
              (
                [
                  ["zip", release.source.zipball],
                  ["tar.gz", release.source.tarball],
                ] as const
              ).map(([format, archive]) => (
                <ReleaseFile
                  key={format}
                  icon={FileArchive}
                  href={`/${username}/${repo}/archive/${encodeURIComponent(release.tagName)}.${format}`}
                  name={`Source code (${format})`}
                  size={archive.size}
                  downloadCount={archive.downloadCount}
                  // an archive per tag is the costliest thing a crawler could fetch
                  nofollow
                />
              ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function ReleaseFile({
  icon: Icon,
  href,
  name,
  size,
  downloadCount,
  nofollow,
}: {
  icon: LucideIcon;
  href: string;
  name: string;
  /** Null while a source archive is being built. */
  size: number | null;
  downloadCount: number;
  nofollow?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <a
        href={href}
        download
        rel={nofollow ? "nofollow" : undefined}
        className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
      >
        {name}
      </a>
      {size !== null && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatBytes(size)}
        </span>
      )}
      <span
        className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums sm:flex"
        title="Downloads"
      >
        <Download className="size-3.5" />
        {downloadCount}
      </span>
    </li>
  );
}

export function ReleaseCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
