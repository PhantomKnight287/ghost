import { describe, expect, test } from 'bun:test';

import { administers, atLeast, organizationRoleOf } from './index';

describe('atLeast', () => {
  test('ranks on the ladder and treats no role as nothing', () => {
    expect(atLeast('maintain', 'write')).toBe(true);
    expect(atLeast('write', 'maintain')).toBe(false);
    expect(atLeast(null, 'read')).toBe(false);
    expect(atLeast(undefined, 'read')).toBe(false);
  });
});

describe('organizationRoleOf', () => {
  test('takes the highest built-in role and ignores the rest', () => {
    expect(organizationRoleOf('member,admin')).toBe('admin');
    expect(organizationRoleOf('billing')).toBeNull();
    expect(organizationRoleOf(null)).toBeNull();
  });
});

describe('administers', () => {
  test('is admins and owners', () => {
    expect(administers('owner')).toBe(true);
    expect(administers('admin')).toBe(true);
    expect(administers('member')).toBe(false);
    expect(administers(null)).toBe(false);
  });
});
