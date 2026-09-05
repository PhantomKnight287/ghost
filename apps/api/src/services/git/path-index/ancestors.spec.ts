import { describe, expect, it } from 'vitest';

import { ancestorsOf } from './repository-path-index.service.js';

describe('ancestorsOf', () => {
  it('walks a file up to the repository root', () => {
    expect(ancestorsOf('src/a/b.ts')).toEqual([
      'src/a/b.ts',
      'src/a',
      'src',
      '',
    ]);
  });

  it('gives a top-level file just itself and the root', () => {
    expect(ancestorsOf('README.md')).toEqual(['README.md', '']);
  });
});
