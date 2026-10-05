"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { loadCodeSearchPage } from "./actions";
import {
  CodeSearchFile,
  type CodeSearchMatch,
  type CodeSearchRepository,
} from "./code-search-file";

/** Appends the next page of matches each time the end of the list comes near the viewport. */
export function CodeSearchMore({
  query,
  repository,
  offset,
}: {
  query: string;
  repository?: CodeSearchRepository;
  offset: number;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<CodeSearchMatch[]>([]);
  const [next, setNext] = useState<number | null>(offset);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const node = sentinel.current;
    if (!node || next === null || error) return;

    let cancelled = false;
    // A fresh observer per page reports at once if the sentinel is still in view, so a short page keeps loading.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        loadCodeSearchPage({ query, repository, offset: next })
          .then((result) => {
            if (cancelled) return;
            if (!result?.data) {
              setError(result?.serverError ?? "Could not load more results.");
              return;
            }
            const { files, nextOffset } = result.data;
            setFiles((loaded) => [...loaded, ...files]);
            setNext(nextOffset);
          })
          .catch(() => {
            if (!cancelled) setError("Could not load more results.");
          });
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [query, repository, next, error]);

  return (
    <>
      {/* The index can reorder between pages, so a path may repeat; the list only grows, so a position is a stable key. */}
      {files.map((file, i) => (
        <CodeSearchFile key={i} file={file} repository={repository} />
      ))}
      {error ? (
        <div className="flex items-center justify-center gap-3 py-4 text-sm text-muted-foreground">
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setError(undefined)}
          >
            Retry
          </Button>
        </div>
      ) : (
        next !== null && (
          <div
            ref={sentinel}
            className="flex justify-center py-4 text-muted-foreground"
          >
            <LoaderCircle
              className="size-5 animate-spin"
              aria-label="Loading more results"
            />
          </div>
        )
      )}
    </>
  );
}
