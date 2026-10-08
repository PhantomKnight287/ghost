"use client";

import { useQuery } from "@tanstack/react-query";
import { File, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, unwrap } from "@/lib/api/client";
import { rankPaths } from "@/lib/fuzzy-path";
import { revisionHref } from "@/lib/revision";
import { cn } from "@/lib/utils";

// ponytail: rendering is capped rather than virtualized; @tanstack/react-virtual is installed if people want to scroll every match.
const SHOWN = 50;

/** GitHub's `t` file finder: fuzzy-matches every file name at the revision and opens the chosen file. */
export function FileFinder({
  base,
  username,
  slug,
  revision,
}: {
  base: string;
  username: string;
  slug: string;
  revision: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // form fields and contenteditable are ignored by default, so typing a "t" never opens the finder
  useHotkeys("t", () => setOpen(true), { preventDefault: true });

  const { data, isPending, error } = useQuery({
    queryKey: ["repository-paths", username, slug, revision],
    queryFn: () =>
      unwrap(
        apiClient.GET("/api/repositories/{username}/{slug}/paths", {
          params: { path: { username, slug }, query: { ref: revision } },
        }),
      ),
    enabled: open,
    staleTime: 60_000,
  });

  const matches = rankPaths(data?.paths ?? [], query, SHOWN);
  const hrefOf = (path: string) => revisionHref(base, "blob", revision, path);

  const listKeys = useHotkeys<HTMLInputElement>(
    "up, down, enter",
    (event) => {
      if (event.key === "Enter") {
        if (!matches[active]) return;
        setOpen(false);
        router.push(hrefOf(matches[active]));
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        (i) => (i + step + matches.length) % Math.max(matches.length, 1),
      );
    },
    { enabled: open, enableOnFormTags: ["input"], preventDefault: true },
    [matches, active],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-keyshortcuts="t">
          <Search data-icon="inline-start" />
          <span className="max-sm:sr-only">Go to file</span>
          <kbd className="ml-1 rounded border px-1 font-mono text-xs text-muted-foreground max-sm:hidden">
            t
          </kbd>
        </Button>
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="top-20 translate-y-0 gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Go to file</DialogTitle>
        <div className="border-b p-2">
          <Input
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              matches[active] ? `${listId}-${active}` : undefined
            }
            placeholder="Find a file…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            ref={listKeys}
            className="border-0 focus-visible:ring-0"
          />
        </div>

        <ul id={listId} role="listbox" className="max-h-96 overflow-y-auto p-1">
          {isPending ? (
            Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="px-2 py-1.5">
                <Skeleton
                  className="h-4"
                  style={{ width: `${40 + ((i * 23) % 50)}%` }}
                />
              </li>
            ))
          ) : error ? (
            <li className="px-2 py-6 text-center text-destructive">
              {error.message}
            </li>
          ) : matches.length === 0 ? (
            <li className="px-2 py-6 text-center text-muted-foreground">
              No matching files
            </li>
          ) : (
            matches.map((path, i) => (
              <li
                key={path}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                ref={
                  i === active
                    ? (el) => el?.scrollIntoView({ block: "nearest" })
                    : undefined
                }
              >
                <Link
                  href={hrefOf(path)}
                  onClick={() => setOpen(false)}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    i === active && "bg-muted",
                  )}
                >
                  <File className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs">{path}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
