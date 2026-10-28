import { describe, expect, it } from 'vitest';

import { appSlug } from './slug.js';

describe('appSlug', () => {
  it('lowercases a name and joins its words with hyphens', () => {
    expect(appSlug('My CI Bot')).toBe('my-ci-bot');
  });

  it('collapses every run of other characters into one hyphen and trims the ends', () => {
    expect(appSlug('  Lint!!  bot  ')).toBe('lint-bot');
  });

  it('transliterates accented letters, as team slugs do', () => {
    expect(appSlug('Ünïcode')).toBe('unicode');
  });

  it('leaves nothing of a name without letters or digits', () => {
    expect(appSlug('!!!')).toBe('');
  });
});
