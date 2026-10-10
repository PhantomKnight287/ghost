import { describe, expect, it } from 'vitest';

import { grantableScopes, hasScope, KNOWN_SCOPES, scopesOfKey } from './scopes.js';

describe('hasScope', () => {
  it('accepts a scope that is granted or implied by a broader one', () => {
    expect(hasScope(['repo'], 'repo')).toBe(true);
    expect(hasScope(['repo'], 'public_repo')).toBe(true);
    expect(hasScope(['admin:org'], 'read:org')).toBe(true);
    expect(hasScope(['admin:public_key'], 'read:public_key')).toBe(true);
    expect(hasScope(['user'], 'user:email')).toBe(true);
  });

  it('refuses a broader scope than the one granted', () => {
    expect(hasScope(['public_repo'], 'repo')).toBe(false);
    expect(hasScope(['read:org'], 'write:org')).toBe(false);
    expect(hasScope([], 'repo')).toBe(false);
  });
});

describe('grantableScopes', () => {
  it('keeps the known scopes gh asks for and drops the rest', () => {
    expect(grantableScopes('repo read:org gist workflow codespace')).toEqual(['repo', 'read:org', 'gist']);
    expect(grantableScopes('')).toEqual([]);
  });
});

describe('scopesOfKey', () => {
  it('reads the scopes a key was granted', () => {
    expect(scopesOfKey({ scopes: ['repo', 'read:org'] })).toEqual(['repo', 'read:org']);
  });

  it('gives a key made in Ghost, which has no scopes, every scope', () => {
    expect(scopesOfKey(null)).toEqual(KNOWN_SCOPES);
    expect(scopesOfKey({})).toEqual(KNOWN_SCOPES);
  });
});
