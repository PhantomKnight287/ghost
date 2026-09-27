"use client";

import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { ReactNode } from "react";

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

/** Highlights diffs off the main thread. Every diff renders inside one, and a page mounts one for all of them. */
export function DiffsProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
