import { describe, expect, it } from 'vitest';

import { repositoryPermissionOf } from './permission.js';

describe('repositoryPermissionOf', () => {
  it.each([
    ['owner', 'ADMIN'],
    ['admin', 'ADMIN'],
    ['maintain', 'MAINTAIN'],
    ['write', 'WRITE'],
    ['triage', 'TRIAGE'],
    ['read', 'READ'],
    [null, null],
  ] as const)('%s -> %s', (role, permission) => {
    expect(repositoryPermissionOf(role)).toBe(permission);
  });
});
