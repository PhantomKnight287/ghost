"use client";

import { PatchDiff } from "@pierre/diffs/react";

const options = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
  diffStyle: "unified",
  disableFileHeader: true,
  hunkSeparators: "simple",
} as const;

/** A few rows of a diff, such as the ones a line comment points at, highlighted like the files tab. Renders inside a `DiffsProvider`. */
export function DiffHunk({ path, hunk }: { path: string; hunk: string }) {
  return (
    <PatchDiff
      patch={`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}\n`}
      options={options}
    />
  );
}
