import { describe, expect, it } from 'vitest';

import { normalizeRefPattern, refTargeted } from './ref-pattern.js';

const branches = (include: string[], exclude: string[] = []) => ({
  target: 'branch' as const,
  include,
  exclude,
});
const tags = (include: string[], exclude: string[] = []) => ({
  target: 'tag' as const,
  include,
  exclude,
});
const branch = (name: string) => `refs/heads/${name}`;
const tag = (name: string) => `refs/tags/${name}`;

describe('normalizeRefPattern', () => {
  it('stores the full ref form, whether or not the prefix was given', () => {
    expect(normalizeRefPattern('branch', 'main')).toBe('refs/heads/main');
    expect(normalizeRefPattern('branch', 'refs/heads/main')).toBe(
      'refs/heads/main',
    );
    expect(normalizeRefPattern('tag', 'v*')).toBe('refs/tags/v*');
    expect(normalizeRefPattern('tag', 'refs/tags/v*')).toBe('refs/tags/v*');
  });

  it('keeps the special targets as they are', () => {
    expect(normalizeRefPattern('branch', '~DEFAULT_BRANCH')).toBe(
      '~DEFAULT_BRANCH',
    );
    expect(normalizeRefPattern('branch', '~ALL')).toBe('~ALL');
    expect(normalizeRefPattern('tag', '~ALL')).toBe('~ALL');
  });
});

describe('refTargeted', () => {
  const targets = (
    conditions: ReturnType<typeof branches>,
    ref: string,
    defaultBranch = 'main',
  ) => refTargeted(conditions, ref, defaultBranch);

  it('matches an exact name, with or without the prefix', () => {
    expect(targets(branches(['main']), branch('main'))).toBe(true);
    expect(targets(branches(['refs/heads/main']), branch('main'))).toBe(true);
    expect(targets(branches(['main']), branch('mainline'))).toBe(false);
    expect(targets(branches(['main']), branch('feature/main'))).toBe(false);
  });

  it('never lets a branch ruleset target a tag, or a tag ruleset a branch', () => {
    expect(targets(branches(['~ALL']), tag('v1'))).toBe(false);
    expect(refTargeted(tags(['~ALL']), branch('main'), 'main')).toBe(false);
    expect(refTargeted(tags(['main']), tag('main'), 'main')).toBe(true);
    expect(refTargeted(tags(['main']), branch('main'), 'main')).toBe(false);
  });

  it('`*` stays within one segment of the name', () => {
    expect(targets(branches(['*']), branch('main'))).toBe(true);
    expect(targets(branches(['*']), branch('feature/x'))).toBe(false);
    expect(targets(branches(['qa*']), branch('qa'))).toBe(true);
    expect(targets(branches(['qa*']), branch('qa-1'))).toBe(true);
    expect(targets(branches(['qa*']), branch('qa/1'))).toBe(false);
    expect(targets(branches(['release/*']), branch('release/1.0'))).toBe(true);
    expect(targets(branches(['release/*']), branch('release/1.0/hotfix'))).toBe(
      false,
    );
    expect(targets(branches(['release/*']), branch('release'))).toBe(false);
  });

  it('`**/` crosses segments, as GitHub documents for `releases/**/*`', () => {
    expect(targets(branches(['release/**/*']), branch('release/1.0'))).toBe(
      true,
    );
    expect(
      targets(branches(['release/**/*']), branch('release/1.0/hotfix')),
    ).toBe(true);
    expect(targets(branches(['release/**/*']), branch('other/1.0'))).toBe(
      false,
    );
    expect(targets(branches(['**/*']), branch('main'))).toBe(true);
    expect(targets(branches(['**/*']), branch('a/b/c'))).toBe(true);
    expect(targets(branches(['**/*feature*']), branch('team/my-feature'))).toBe(
      true,
    );
  });

  it('reads a trailing `**` as `*`, as Ruby fnmatch does: only `**/` crosses segments', () => {
    expect(targets(branches(['release/**']), branch('release/1.0'))).toBe(true);
    expect(
      targets(branches(['release/**']), branch('release/1.0/hotfix')),
    ).toBe(false);
    expect(
      targets(branches(['~ALL'], ['release/**']), branch('release/1.0/hotfix')),
    ).toBe(true);
  });

  it('matches a run of `**/` as one, and quickly', () => {
    expect(targets(branches(['**/**/x']), branch('a/b/x'))).toBe(true);
    expect(targets(branches(['**/**/x']), branch('x'))).toBe(true);
    const started = performance.now();
    expect(
      targets(
        branches([`${'**/'.repeat(40)}x`]),
        branch(`${'a/'.repeat(60)}y`),
      ),
    ).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('stays fast when wildcards are apart, which a backtracking matcher is not', () => {
    const started = performance.now();
    expect(
      targets(
        branches([`${'**/a/'.repeat(8)}b`]),
        branch(`${'a/'.repeat(60)}a`),
      ),
    ).toBe(false);
    expect(
      targets(branches([`${'a*'.repeat(40)}b`]), branch('a'.repeat(200))),
    ).toBe(false);
    expect(
      targets(branches([`${'**/a/'.repeat(3)}b`]), branch('x/a/y/a/a/b')),
    ).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('takes braces literally', () => {
    expect(targets(branches(['{a,b}']), branch('a'))).toBe(false);
    expect(targets(branches(['{a,b}']), branch('{a,b}'))).toBe(true);
  });

  it('never matches `/` with a character class', () => {
    expect(targets(branches(['a[/]b']), branch('a/b'))).toBe(false);
    expect(targets(branches(['a[!x]b']), branch('a/b'))).toBe(false);
    expect(targets(branches(['a[!x]b']), branch('ayb'))).toBe(true);
  });

  it('supports `?` and character classes', () => {
    expect(refTargeted(tags(['v?']), tag('v1'), 'main')).toBe(true);
    expect(refTargeted(tags(['v?']), tag('v10'), 'main')).toBe(false);
    expect(refTargeted(tags(['v[0-9]*']), tag('v2.1'), 'main')).toBe(true);
    expect(refTargeted(tags(['v[0-9]*']), tag('vx'), 'main')).toBe(false);
  });

  it('takes regular-expression characters in a name literally', () => {
    expect(targets(branches(['a.b']), branch('a.b'))).toBe(true);
    expect(targets(branches(['a.b']), branch('axb'))).toBe(false);
    expect(targets(branches(['a+b']), branch('a+b'))).toBe(true);
    expect(targets(branches(['(x)']), branch('(x)'))).toBe(true);
  });

  it('resolves ~DEFAULT_BRANCH against the default branch it is given', () => {
    expect(targets(branches(['~DEFAULT_BRANCH']), branch('main'))).toBe(true);
    expect(targets(branches(['~DEFAULT_BRANCH']), branch('trunk'))).toBe(false);
    expect(
      targets(branches(['~DEFAULT_BRANCH']), branch('trunk'), 'trunk'),
    ).toBe(true);
    expect(
      targets(branches(['~DEFAULT_BRANCH']), branch('main'), 'trunk'),
    ).toBe(false);
  });

  it('~ALL targets every ref of the type', () => {
    expect(targets(branches(['~ALL']), branch('main'))).toBe(true);
    expect(targets(branches(['~ALL']), branch('deep/nested/name'))).toBe(true);
    expect(refTargeted(tags(['~ALL']), tag('v1/rc'), 'main')).toBe(true);
  });

  it('needs one include to match and no exclude to match', () => {
    expect(targets(branches(['~ALL'], ['main']), branch('main'))).toBe(false);
    expect(targets(branches(['~ALL'], ['main']), branch('dev'))).toBe(true);
    expect(
      targets(
        branches(['release/**/*'], ['release/old/*']),
        branch('release/old/1'),
      ),
    ).toBe(false);
    expect(targets(branches(['main', 'dev']), branch('dev'))).toBe(true);
    expect(
      targets(branches(['~ALL'], ['~DEFAULT_BRANCH']), branch('main')),
    ).toBe(false);
  });

  it('targets nothing with an empty include list', () => {
    expect(targets(branches([]), branch('main'))).toBe(false);
    expect(targets(branches([], ['dev']), branch('main'))).toBe(false);
  });
});
