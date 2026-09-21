import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  File,
  Folder,
  GitCommitHorizontal,
  RotateCcwClock,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { components } from "@/lib/api/v1";
import { FromNowHoverCard } from "../from-now-card";

type Contents = components["schemas"]["GetRepositoryContentsResponseDTO"];
type TreeEntry = components["schemas"]["TreeEntryDTO"];

function EntryIcon({ type }: { type: TreeEntry["type"] }) {
  const Icon = type === "blob" ? File : Folder;

  return (
    <Icon
      className={cn(
        "size-4 shrink-0 fill-muted",
        type === "blob" ? "text-muted-foreground" : "text-primary",
      )}
    />
  );
}

export function RepositoryContents({
  contents,
  owner,
  slug,
}: {
  contents: Contents;
  owner: string;
  slug: string;
}) {
  const branch = contents.ref.replace(/^refs\/heads\//, "");

  if (contents.entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">
          {contents.path ? "Nothing here" : "This repository is empty"}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {contents.path
            ? `${contents.path} is not a directory on ${branch}.`
            : "Push a commit to see its files here."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      {contents.commit && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
          <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">
            {contents.commit.subject}
          </span>
          <code className="ml-auto shrink-0 text-xs text-muted-foreground">
            {contents.commit.sha.slice(0, 7)}
          </code>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(contents.commit.committedAt), {
              addSuffix: true,
            })}
          </span>
          <Link
            href={`/${owner}/${slug}/commits/${encodeURIComponent(branch)}`}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcwClock className="size-3.5" />
            {contents.commitCount} Commits
          </Link>
        </div>
      )}

      <ul className="divide-y">
        {contents.entries.map((entry) => (
          <li
            key={entry.oid + entry.path}
            className="flex items-center gap-3 justify-between px-4 py-2.5 text-sm hover:bg-muted/40"
          >
            <div className="flex min-w-0 flex-1 flex-row items-center gap-3">
              <EntryIcon type={entry.type} />

              <Link
                href={`/${owner}/${slug}/${entry.type === "tree" ? "tree" : "blob"}/${encodeURIComponent(branch)}/${entry.path
                  .split("/")
                  .map(encodeURIComponent)
                  .join("/")}`}
                className="min-w-0 truncate hover:text-primary hover:underline"
              >
                {entry.name}
              </Link>
            </div>

            <div className="flex shrink-0 flex-row items-center gap-3">
              <span className="hidden max-w-xs truncate text-xs text-muted-foreground md:block">
                {entry.lastCommit?.subject}
              </span>

              <span className="w-28 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
                {entry.lastCommit && (
                  <FromNowHoverCard date={entry.lastCommit.committedAt} />
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
