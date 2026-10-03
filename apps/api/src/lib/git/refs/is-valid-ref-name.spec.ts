import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { isValidRefName, isWellFormedRef } from './is-valid-ref-name.js';

describe('isValidRefName', () => {
  it('accepts names git accepts, including a slash', () => {
    for (const name of ['v1.0.0', 'release/2026-09', 'feat/branches']) {
      expect(isValidRefName('tags', name)).toBe(true);
      expect(isValidRefName('heads', name)).toBe(true);
    }
  });

  it('refuses flags, revision syntax, HEAD and empty names', () => {
    for (const name of [
      '',
      '-all',
      '--delete',
      'HEAD',
      'v1..2',
      'v1^{tree}',
      'a b',
      'v1.lock',
      'x~1',
    ]) {
      expect(isValidRefName('heads', name)).toBe(false);
    }
  });
});

describe('isWellFormedRef', () => {
  const gitAccepts = (ref: string) => {
    try {
      execFileSync('git', ['check-ref-format', ref], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  it('agrees with git check-ref-format on every rule', () => {
    const corpus = [
      'refs/heads/main',
      'refs/heads/feat/a-b_c.1',
      'refs/tags/v1.0.0',
      'refs/pull/1/head',
      'refs/heads/a@b',
      'refs/heads/é',
      'refs/heads/.hidden',
      'refs/heads/a/.b',
      'refs/heads/a.lock',
      'refs/heads/a.lock/b',
      'refs/heads/a..b',
      'refs/heads/a b',
      'refs/heads/a\tb',
      'refs/heads/a\x7fb',
      'refs/heads/a~1',
      'refs/heads/a^',
      'refs/heads/a:b',
      'refs/heads/a?',
      'refs/heads/a*',
      'refs/heads/a[b',
      'refs/heads/a\\b',
      'refs/heads/a@{1}',
      'refs/heads//a',
      'refs/heads/a/',
      'refs/heads/a.',
      '/refs/heads/a',
      'refs/heads/a.b.',
      'refs/heads/@',
      'refs/heads/a/./b',
      'refs/heads/-dash',
    ];
    for (const ref of corpus) {
      expect([ref, isWellFormedRef(ref)]).toEqual([ref, gitAccepts(ref)]);
    }
  });

  it('only accepts refs under refs/', () => {
    for (const ref of ['HEAD', 'main', '@', 'heads/main']) {
      expect(isWellFormedRef(ref)).toBe(false);
    }
  });
});
