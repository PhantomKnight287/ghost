"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, unwrap } from "@/lib/api/client";
import { revisionHref } from "@/lib/revision";
import { cn } from "@/lib/utils";

type Tree = {
  base: string;
  username: string;
  slug: string;
  revision: string;
  current: string;
  /** Folders the viewer opened or closed; any other folder is open only when it holds the current file. */
  toggled: Record<string, boolean>;
  toggle: (path: string, open: boolean) => void;
};

/** The repository's files at `revision`, opened down to `current`. Each folder lists itself only once it is opened. */
export function FileTree({
  base,
  username,
  slug,
  revision,
  current,
}: Omit<Tree, "toggled" | "toggle">) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const tree: Tree = {
    base,
    username,
    slug,
    revision,
    current,
    toggled,
    toggle: (path, open) => setToggled((t) => ({ ...t, [path]: open })),
  };

  return (
    <ul role="tree" aria-label="Files" className="p-1 text-sm">
      <TreeDirectory tree={tree} dir="" depth={0} />
    </ul>
  );
}

function TreeDirectory({
  tree,
  dir,
  depth,
}: {
  tree: Tree;
  dir: string;
  depth: number;
}) {
  const { username, slug, revision } = tree;
  const { data, isPending, error } = useQuery({
    queryKey: ["repository-contents", username, slug, revision, dir],
    queryFn: () =>
      unwrap(
        apiClient.GET("/api/repositories/{username}/{slug}/contents", {
          params: {
            path: { username, slug },
            query: { ref: revision, path: dir || undefined },
          },
        }),
      ),
    staleTime: 60_000,
  });
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (isPending) {
    return Array.from({ length: 3 }).map((_, i) => (
      <li key={i} role="none" className="py-1.5 pr-2" style={indent}>
        <Skeleton className="h-4" style={{ width: `${45 + i * 15}%` }} />
      </li>
    ));
  }
  if (error) {
    return (
      <li
        role="none"
        className="py-1.5 pr-2 text-xs text-destructive"
        style={indent}
      >
        {error.message}
      </li>
    );
  }

  return data.entries.map((entry) => {
    const row =
      "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left";

    if (entry.type === "commit") {
      return (
        <li
          key={entry.path}
          role="treeitem"
          aria-selected={false}
          title="Submodule"
          className={cn(row, "text-muted-foreground")}
          style={indent}
        >
          <span className="size-3.5 shrink-0" />
          <FolderGit2 className="size-4 shrink-0" />
          <span className="truncate">{entry.name}</span>
        </li>
      );
    }

    if (entry.type === "blob") {
      const active = entry.path === tree.current;
      return (
        <li key={entry.path} role="treeitem" aria-selected={active}>
          <Link
            href={revisionHref(tree.base, "blob", revision, entry.path)}
            aria-current={active ? "page" : undefined}
            ref={
              active
                ? (el) => el?.scrollIntoView({ block: "nearest" })
                : undefined
            }
            className={cn(
              row,
              "hover:bg-muted/60",
              active && "bg-muted font-medium",
            )}
            style={indent}
          >
            <span className="size-3.5 shrink-0" />
            <File className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.name}</span>
          </Link>
        </li>
      );
    }

    const open =
      tree.toggled[entry.path] ?? tree.current.startsWith(`${entry.path}/`);
    return (
      <li
        key={entry.path}
        role="treeitem"
        aria-selected={false}
        aria-expanded={open}
      >
        <button
          type="button"
          onClick={() => tree.toggle(entry.path, !open)}
          className={cn(row, "hover:bg-muted/60")}
          style={indent}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <Folder className="size-4 shrink-0 fill-muted text-primary" />
          <span className="truncate">{entry.name}</span>
        </button>
        {open && (
          <ul role="group">
            <TreeDirectory tree={tree} dir={entry.path} depth={depth + 1} />
          </ul>
        )}
      </li>
    );
  });
}
