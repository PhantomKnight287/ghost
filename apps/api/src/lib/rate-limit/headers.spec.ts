import { describe, expect, it } from 'vitest';

import type { Budget } from './budgets.js';
import {
  rateLimitHeaders,
  type RateLimitDecision,
  tightest,
} from './headers.js';

const core: Budget = { name: 'core', resource: 'core', limit: 120 };
const search: Budget = { name: 'search', resource: 'search', limit: 30 };
const decision = (
  overrides: Partial<RateLimitDecision> = {},
): RateLimitDecision => ({
  budget: core,
  used: 5,
  remaining: 115,
  resetAt: 1761480000,
  retryAfter: 42,
  allowed: true,
  ...overrides,
});

describe('rateLimitHeaders', () => {
  it("names GitHub's headers, with the reset in epoch seconds", () => {
    expect(rateLimitHeaders(decision())).toEqual({
      'X-RateLimit-Limit': '120',
      'X-RateLimit-Remaining': '115',
      'X-RateLimit-Used': '5',
      'X-RateLimit-Reset': '1761480000',
      'X-RateLimit-Resource': 'core',
    });
  });

  it('adds Retry-After only when the request is refused', () => {
    expect(
      rateLimitHeaders(decision({ allowed: false, used: 120, remaining: 0 })),
    ).toEqual({
      'X-RateLimit-Limit': '120',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Used': '120',
      'X-RateLimit-Reset': '1761480000',
      'X-RateLimit-Resource': 'core',
      'Retry-After': '42',
    });
  });
});

describe('tightest', () => {
  it('shows the budget with the fewest requests left', () => {
    const roomy = decision();
    const tight = decision({ budget: search, used: 29, remaining: 1 });
    expect(tightest([roomy, tight])).toBe(tight);
    expect(tightest([tight, roomy])).toBe(tight);
  });

  it('shows a refusal over any budget that still has room', () => {
    const refused = decision({ allowed: false, used: 120, remaining: 0 });
    const emptyButAllowed = decision({
      budget: search,
      used: 30,
      remaining: 0,
    });
    expect(tightest([emptyButAllowed, refused])).toBe(refused);
  });
});
