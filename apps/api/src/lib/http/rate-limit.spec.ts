import { describe, expect, it } from 'vitest';

import { rateLimitPerMinute, rateLimitTracker } from './rate-limit.js';

describe('rate limit', () => {
  const anonymous = { headers: {}, ip: '10.0.0.1', user: null };
  const signedIn = { ...anonymous, user: { id: 'user_1' } };

  it('counts a signed-in caller per account, with the API key budget', () => {
    expect(rateLimitTracker(signedIn)).toBe('user:user_1');
    expect(rateLimitPerMinute(signedIn)).toBe(120);
  });

  it('counts an anonymous caller per address, with less', () => {
    expect(rateLimitTracker(anonymous)).toBe('ip:10.0.0.1');
    expect(rateLimitPerMinute(anonymous)).toBe(30);
  });
});
