const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** A `+++` file name as git writes it: C-quoted with octal UTF-8 bytes when it holds unusual characters, or followed by a tab when it holds a space. */
function headerName(raw: string) {
  if (!raw.startsWith('"')) return raw.replace(/\t$/, "");
  const bytes: number[] = [];
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i] !== "\\") {
      bytes.push(...new TextEncoder().encode(raw[i]));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(raw.slice(i + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(ESCAPES[raw[i + 1]] ?? raw.charCodeAt(i + 1));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The new-file line ranges each file's hunks show, keyed by the `+++ b/` path, so a rename is keyed by its new name and a deleted file is absent. */
export function additionRanges(patch: string) {
  const ranges = new Map<string, [start: number, end: number][]>();
  let path: string | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      const name = headerName(line.slice("+++ ".length));
      path = name.startsWith("b/") ? name.slice("b/".length) : null;
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
