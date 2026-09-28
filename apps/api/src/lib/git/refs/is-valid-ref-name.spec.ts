import { describe, expect, it } from 'vitest';

import { isValidRefName } from './is-valid-ref-name.js';

describe('isValidRefName', () => {
  it('accepts names git accepts, including a slash', async () => {
    for (const name of ['v1.0.0', 'release/2026-09', 'feat/branches']) {
      await expect(isValidRefName('tags', name)).resolves.toBe(true);
      await expect(isValidRefName('heads', name)).resolves.toBe(true);
    }
  });

  it('refuses flags, revision syntax, HEAD and empty names', async () => {
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
      await expect(isValidRefName('heads', name)).resolves.toBe(false);
    }
  });
});
