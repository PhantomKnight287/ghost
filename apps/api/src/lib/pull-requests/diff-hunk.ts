import type { Hunk } from '../git/diff/diff.js';

type DiffSide = 'deletions' | 'additions';

// Rows of the diff shown above a comment's first line, enough to read it in the conversation the way GitHub shows a diff hunk.
const CONTEXT_LINES = 3;

/** The part of the diff a line comment points at, as a hunk with its own `@@` header: a few lines of lead-in, then its lines. Null when the diff does not show that line. */
export function diffHunkFor(
  hunks: Hunk[],
  {
    side,
    line,
    startSide,
    startLine,
  }: {
    side: DiffSide;
    line: number;
    startSide?: DiffSide | null;
    startLine?: number | null;
  },
): string | null {
  const at =
    (onSide: DiffSide, number: number) => (row: Hunk['lines'][number]) =>
      onSide === 'additions'
        ? row.kind !== '-' && row.new === number
        : row.kind !== '+' && row.old === number;

  for (const hunk of hunks) {
    const end = hunk.lines.findIndex(at(side, line));
    if (end === -1) continue;
    const start = hunk.lines.findIndex(
      at(startSide ?? side, startLine ?? line),
    );
    const rows = hunk.lines.slice(
      Math.max((start === -1 ? end : Math.min(start, end)) - CONTEXT_LINES, 0),
      end + 1,
    );
    const oldCount = rows.filter((row) => row.kind !== '+').length;
    const newCount = rows.filter((row) => row.kind !== '-').length;
    return [
      `@@ -${rows[0].old},${oldCount} +${rows[0].new},${newCount} @@`,
      ...rows.map((row) => `${row.kind}${row.text}`),
    ].join('\n');
  }
  return null;
}
