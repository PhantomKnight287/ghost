import { FileDiffs } from "@/components/diffs/file-diffs";

import type { DiffViewProps } from "@/types/pull-request";

export function DiffView({ from, to, files, patchUrl }: DiffViewProps) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm">
        <span className="font-medium">
          {files.length} changed file{files.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-xs tabular-nums">
          <span className="text-emerald-500">+{additions}</span>{" "}
          <span className="text-red-500">−{deletions}</span>
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {from.slice(0, 7)}…{to.slice(0, 7)}
        </span>
      </div>

      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          This branch changes nothing against the base.
        </p>
      ) : (
        <FileDiffs patchUrl={patchUrl} files={files} />
      )}
    </div>
  );
}
