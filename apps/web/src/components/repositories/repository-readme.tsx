import Link from "next/link";
import { FileText } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { components } from "@/lib/api/v1";
import { API_URL } from "@/lib/env";

type Readme = components["schemas"]["GetRepositoryReadmeResponseDTO"];

export function RepositoryReadme({
  readme,
  owner,
  slug,
  bare = false,
}: {
  readme: Readme;
  owner: string;
  slug: string;
  /** Drops the card and its filename bar, for a profile where neither fits. */
  bare?: boolean;
}) {
  if (!readme.path) return null;

  const branch = readme.ref.replace(/^refs\/heads\//, "");
  // a README in a subdirectory writes paths relative to that directory
  const directory = readme.path.split("/").slice(0, -1).join("/");
  const rawHref = (path: string) =>
    `${API_URL}/api/repositories/${owner}/${slug}/raw?ref=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`;

  /** A README writes paths relative to itself, so a link out of it is either a file in this repository or nothing. Images go to the raw bytes; everything else goes to the page for that path. */
  const resolveUrl = (url: string, key: string) => {
    const [path, hash] = splitHash(resolve(url, directory));
    if (!path) return `#${hash}`;
    return key === "src"
      ? rawHref(path)
      : `/${owner}/${slug}/blob/${encodeURIComponent(branch)}/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}${hash ? `#${hash}` : ""}`;
  };

  const body =
    readme.content === null ? (
      <p className="text-sm text-muted-foreground">
        This README is too large to render.{" "}
        <Link href={rawHref(readme.path)} className="text-primary underline">
          View the raw file
        </Link>
        .
      </p>
    ) : (
      <Markdown resolveUrl={resolveUrl}>{readme.content}</Markdown>
    );

  if (bare) return body;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{readme.path}</span>
      </div>

      <div className="px-4 py-4 md:px-6">{body}</div>
    </div>
  );
}

/** "#anchor" off the end of a path, so a link can carry both. */
function splitHash(url: string): [string, string] {
  const hash = url.indexOf("#");
  return hash === -1 ? [url, ""] : [url.slice(0, hash), url.slice(hash + 1)];
}

/**
 * A repository-relative path, resolved against the directory the README sits in: `./` drops, `../` pops, and a leading `/` is root-relative rather than a host path.
 *
 * `..` past the root is dropped rather than escaping the repository.
 */
export function resolve(url: string, directory = "") {
  // a root-relative link ignores where the README is
  const base = url.startsWith("/") || !directory ? "" : `${directory}/`;
  const segments: string[] = [];

  for (const segment of `${base}${url}`.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }

  return segments.join("/");
}

/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton rows have no id */
export function RepositoryReadmeSkeleton({ bare = false }: { bare?: boolean }) {
  const lines = (
    <div className={cn("flex flex-col gap-3", !bare && "px-4 py-4 md:px-6")}>
      <Skeleton className="h-6 w-56" />
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton
          key={index}
          className="h-4"
          style={{ width: `${70 + ((index * 53) % 30)}%` }}
        />
      ))}
    </div>
  );

  if (bare) return lines;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <Skeleton className="size-4" />
        <Skeleton className="h-4 w-24" />
      </div>

      {lines}
    </div>
  );
}
