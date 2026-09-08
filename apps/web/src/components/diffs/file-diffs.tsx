"use client";

import { Virtualizer } from "@pierre/diffs";
import {
  PatchDiff,
  VirtualizerContext,
  WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { LazyFileDiffProps, LazyFileDiffsProps } from "@/types/diffs";

const poolOptions = {
  poolSize: 4,
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    }),
};

const highlighterOptions = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
} as const;

const diffOptions = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
  diffStyle: "split",
} as const;

export function FileDiffs({ patchUrl, files }: LazyFileDiffsProps) {
  // The page itself is the scroll container, so the virtualizer is built here
  // rather than with the library's own scroll-box component.
  const [virtualizer] = useState(() =>
    typeof window === "undefined" ? undefined : new Virtualizer(),
  );

  useEffect(() => {
    virtualizer?.setup(document);
    return () => virtualizer?.cleanUp();
  }, [virtualizer]);

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      <VirtualizerContext.Provider value={virtualizer}>
        <div className="flex flex-col gap-4">
          {files.map((file) => (
            <LazyFileDiff key={file.path} patchUrl={patchUrl} file={file} />
          ))}
        </div>
      </VirtualizerContext.Provider>
    </WorkerPoolContextProvider>
  );
}

/**
 * A patch of thousands of files is tens of megabytes, so each file is fetched
 * on its own once it comes near the viewport.
 */
function LazyFileDiff({ patchUrl, file }: LazyFileDiffProps) {
  const container = useRef<HTMLDivElement>(null);
  const [patch, setPatch] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = container.current;
    if (!node || file.binary) return;

    const controller = new AbortController();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const url = new URL(patchUrl);
        url.searchParams.set("path", file.path);

        fetch(url, { credentials: "include", signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error(String(response.status));
            return response.text();
          })
          .then(setPatch)
          .catch(() => {
            if (!controller.signal.aborted) setFailed(true);
          });
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [patchUrl, file.path, file.binary]);

  return (
    <div ref={container}>
      {patch ? (
        <PatchDiff patch={patch} options={diffOptions} />
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <span className="font-mono text-xs text-muted-foreground">
            {file.path}
          </span>
          {file.binary ? (
            <span className="text-xs text-muted-foreground">
              Binary file not shown
            </span>
          ) : failed ? (
            <span className="text-xs text-muted-foreground">
              Could not load this diff.
            </span>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </div>
      )}
    </div>
  );
}
