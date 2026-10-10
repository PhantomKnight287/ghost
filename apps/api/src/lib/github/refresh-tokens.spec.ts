import { describe, expect, it } from 'vitest';

import { hashRefreshToken, newRefreshToken } from './refresh-tokens.js';

describe('refresh tokens', () => {
  it('are ghost_rt_ followed by 32 random bytes, base64url', () => {
    const token = newRefreshToken();
    expect(token).toMatch(/^ghost_rt_[A-Za-z0-9_-]{43}$/);
    expect(newRefreshToken()).not.toBe(token);
  });

  it('hash to a stable sha256 hex digest', () => {
    expect(hashRefreshToken('ghost_rt_x')).toBe(hashRefreshToken('ghost_rt_x'));
    expect(hashRefreshToken('ghost_rt_x')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken('ghost_rt_y')).not.toBe(hashRefreshToken('ghost_rt_x'));
  });
});
