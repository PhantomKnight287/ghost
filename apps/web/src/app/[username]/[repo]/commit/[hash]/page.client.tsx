"use client";

import { FileDiff } from "@pierre/diffs/react";

import type { PreloadFileDiffResult } from "@pierre/diffs/ssr";

export function CommitDiff({
  files,
}: {
  files: PreloadFileDiffResult<undefined, undefined>[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {files.map((file) => (
        <FileDiff key={file.fileDiff.name} {...file} />
      ))}
    </div>
  );
}
