import { describe, expect, it } from 'vitest';

import {
  isSafeTreePath,
  MAX_TREE_PATH_DEPTH,
  MAX_TREE_PATH_LENGTH,
  normalizeTreePath,
  UnsafeTreePathError,
} from './tree-path.js';

describe('normalizeTreePath', () => {
  it('returns the root as an empty prefix', () => {
    expect(normalizeTreePath('')).toBe('');
    expect(normalizeTreePath('/')).toBe('');
    expect(normalizeTreePath('///')).toBe('');
  });

  it('normalizes a directory to trailing-slash form', () => {
    expect(normalizeTreePath('src')).toBe('src/');
    expect(normalizeTreePath('src/')).toBe('src/');
    expect(normalizeTreePath('/src/deep/')).toBe('src/deep/');
  });

  it('rejects traversal', () => {
    for (const input of [
      '..',
      '../etc',
      'src/../../etc',
      'src/..',
      '/../',
      '.',
      'src/./deep',
    ]) {
      expect(() => normalizeTreePath(input)).toThrow(UnsafeTreePathError);
    }
  });

  /**
   * Express percent-decodes a query value exactly once, so these are the
   * strings that actually arrive. Decoding again in the app would turn the
   * doubly-encoded forms back into traversal.
   */
  it('sees decoded slashes as separators and encoded ones as literal text', () => {
    // "src%2Fdeep" arrives here already decoded
    expect(normalizeTreePath('src/deep')).toBe('src/deep/');
    // "src%252Fdeep" arrives with the escape intact and stays one segment
    expect(normalizeTreePath('src%2Fdeep')).toBe('src%2Fdeep/');
    // so a doubly-encoded traversal never becomes ".."
    expect(normalizeTreePath('%2e%2e')).toBe('%2e%2e/');
  });

  it('rejects NUL and other control characters', () => {
    // a NUL would terminate the argument git actually receives
    expect(() => normalizeTreePath('src\u0000/etc')).toThrow(
      UnsafeTreePathError,
    );
    expect(() => normalizeTreePath('src\n')).toThrow(UnsafeTreePathError);
    expect(() => normalizeTreePath('src\u007f')).toThrow(UnsafeTreePathError);
  });

  it('rejects doubled separators', () => {
    expect(() => normalizeTreePath('src//deep')).toThrow(UnsafeTreePathError);
  });

  it('caps length and depth', () => {
    expect(() =>
      normalizeTreePath('a'.repeat(MAX_TREE_PATH_LENGTH + 1)),
    ).toThrow(UnsafeTreePathError);
    const deep = Array.from(
      { length: MAX_TREE_PATH_DEPTH + 1 },
      () => 'a',
    ).join('/');
    expect(() => normalizeTreePath(deep)).toThrow(UnsafeTreePathError);
  });

  it('allows a path that only looks like pathspec magic', () => {
    // legal filenames; listTree neutralizes them with :(literal)
    expect(normalizeTreePath(':(glob)src')).toBe(':(glob)src/');
    expect(normalizeTreePath('*')).toBe('*/');
  });
});

describe('isSafeTreePath', () => {
  it('mirrors normalizeTreePath without throwing', () => {
    expect(isSafeTreePath('src/deep')).toBe(true);
    expect(isSafeTreePath('')).toBe(true);
    expect(isSafeTreePath('../etc')).toBe(false);
    expect(isSafeTreePath(undefined)).toBe(false);
    expect(isSafeTreePath(42)).toBe(false);
  });
});
