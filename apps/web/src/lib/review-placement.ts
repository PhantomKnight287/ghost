const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** The new-file line ranges each file's hunks show, keyed by the `+++ b/` path, so a rename is keyed by its new name and a deleted file is absent. */
export function additionRanges(patch: string) {
  const ranges = new Map<string, [start: number, end: number][]>();
  let path: string | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      path = line.startsWith("+++ b/") ? line.slice("+++ b/".length) : null;
      continue;
    }
    const hunk = path ? HUNK.exec(line) : null;
    if (!path || !hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) continue;
    ranges.set(path, [...(ranges.get(path) ?? []), [start, start + count - 1]]);
  }
  return ranges;
}

/** Splits threads into those the commit's diff shows a line for and the rest. A deletions-side line counts from the pull request's base, not the commit's parent, so it is never placed. */
export function placeThreads<
  T extends { path: string; side: "additions" | "deletions"; line: number },
>(threads: T[], patch: string) {
  const ranges = additionRanges(patch);
  const placed: T[] = [];
  const unplaced: T[] = [];
  for (const thread of threads) {
    const shown =
      thread.side === "additions" &&
      (ranges.get(thread.path) ?? []).some(
        ([start, end]) => thread.line >= start && thread.line <= end,
      );
    (shown ? placed : unplaced).push(thread);
  }
  return { placed, unplaced };
}
