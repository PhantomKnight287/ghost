import { describe, expect, it } from 'vitest';

import { repositoryScope } from './zoekt.js';

describe('repositoryScope', () => {
  it('adds nothing when unscoped', () => {
    expect(repositoryScope(undefined)).toBe('');
  });

  it('anchors and escapes each repository id', () => {
    expect(repositoryScope(['a.b', 'c'])).toBe(' r:^(a\\.b|c)$');
  });
});
