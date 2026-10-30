import { describe, expect, it } from 'vitest';

import {
  generateUserRefreshToken,
  generateUserToken,
  hashUserToken,
  USER_TOKEN,
} from './user-token.js';

describe('user-to-server tokens', () => {
  it('makes ghu_ tokens of 36 letters and digits', () => {
    const token = generateUserToken();
    expect(token).toMatch(USER_TOKEN);
    expect(token).toMatch(/^ghu_[A-Za-z0-9]{36}$/);
    expect(generateUserToken()).not.toBe(token);
  });

  it('makes ghr_ refresh tokens of 76 letters and digits', () => {
    expect(generateUserRefreshToken()).toMatch(/^ghr_[A-Za-z0-9]{76}$/);
  });

  it('hashes to 64 hex characters', () => {
    expect(hashUserToken('ghu_x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
