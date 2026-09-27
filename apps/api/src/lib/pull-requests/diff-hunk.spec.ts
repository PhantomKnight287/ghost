import { describe, expect, it } from 'vitest';

import { parseHunks } from '../git/diff/diff.js';
import { diffHunkFor } from './diff-hunk.js';

const hunks = parseHunks(
  ['@@ -1,4 +1,5 @@', ' a', ' b', '-c', '+C', '+D', ' e', ' f'].join('\n'),
);

describe('diffHunkFor', () => {
  it('leads into the commented line with the three rows before it and a header of its own', () => {
    expect(diffHunkFor(hunks, { side: 'additions', line: 5 })).toBe(
      ['@@ -3,2 +3,3 @@', '-c', '+C', '+D', ' e'].join('\n'),
    );
  });

  it('covers a whole range, and finds a line on the base side', () => {
    expect(
      diffHunkFor(hunks, {
        side: 'additions',
        line: 4,
        startSide: 'additions',
        startLine: 3,
      }),
    ).toBe(['@@ -1,3 +1,4 @@', ' a', ' b', '-c', '+C', '+D'].join('\n'));
    expect(diffHunkFor(hunks, { side: 'deletions', line: 3 })).toBe(
      ['@@ -1,3 +1,2 @@', ' a', ' b', '-c'].join('\n'),
    );
  });

  it('is null for a line the diff does not show', () => {
    expect(diffHunkFor(hunks, { side: 'additions', line: 40 })).toBeNull();
  });
});
