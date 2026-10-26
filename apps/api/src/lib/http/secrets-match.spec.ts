import { describe, expect, it } from 'vitest';

import { secretsMatch } from './secrets-match.js';

describe('secretsMatch', () => {
  it('matches equal secrets', () => {
    expect(secretsMatch('web-secret', 'web-secret')).toBe(true);
  });

  it('refuses different secrets, of the same length or not', () => {
    expect(secretsMatch('web-secreT', 'web-secret')).toBe(false);
    expect(secretsMatch('web', 'web-secret')).toBe(false);
  });

  it('refuses when either side is empty or missing', () => {
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch(undefined, undefined)).toBe(false);
    expect(secretsMatch('web-secret', '')).toBe(false);
    expect(secretsMatch('', 'web-secret')).toBe(false);
    expect(secretsMatch(undefined, 'web-secret')).toBe(false);
  });
});
