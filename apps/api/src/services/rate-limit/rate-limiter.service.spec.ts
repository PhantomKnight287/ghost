import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Budget } from '../../lib/rate-limit/budgets.js';
import { RateLimiterUnavailableError } from '../../lib/rate-limit/rate-limit.errors.js';
import { RateLimiterService } from './rate-limiter.service.js';

const REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(!REDIS_URL)('RateLimiterService', () => {
  let redis: Redis;
  let limiter: RateLimiterService;
  const budget: Budget = { name: 'spec', resource: 'core', limit: 3 };
  const key = () => randomUUID();

  beforeAll(() => {
    redis = new Redis(REDIS_URL!);
    limiter = new RateLimiterService(redis);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  it('counts down and reports the window', async () => {
    const caller = key();
    const before = Math.floor(Date.now() / 1000);
    const decisions = [
      await limiter.consume(budget, caller),
      await limiter.consume(budget, caller),
      await limiter.consume(budget, caller),
    ];
    expect(decisions.map((decision) => decision.used)).toEqual([1, 2, 3]);
    expect(decisions.map((decision) => decision.remaining)).toEqual([2, 1, 0]);
    expect(decisions.every((decision) => decision.allowed)).toBe(true);
    expect(decisions[0].budget).toBe(budget);
    expect(decisions[0].resetAt).toBeGreaterThanOrEqual(before);
    expect(decisions[0].resetAt).toBeLessThanOrEqual(before + 61);
  });

  it('refuses past the limit without counting', async () => {
    const caller = key();
    for (let i = 0; i < 3; i++) await limiter.consume(budget, caller);
    const refused = await limiter.consume(budget, caller);
    expect(refused).toMatchObject({ allowed: false, used: 3, remaining: 0 });
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfter).toBeLessThanOrEqual(60);
    await limiter.consume(budget, caller);
    expect(await limiter.peek(budget, caller)).toMatchObject({ used: 3 });
  });

  it('starts a fresh window when the old one expires', async () => {
    const short = new RateLimiterService(redis, 1000);
    const caller = key();
    for (let i = 0; i < 3; i++) await short.consume(budget, caller);
    expect((await short.consume(budget, caller)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await short.consume(budget, caller)).toMatchObject({
      allowed: true,
      used: 1,
    });
  });

  it('never leaves a counter without an expiry', async () => {
    const caller = key();
    await limiter.consume(budget, caller);
    expect(
      await redis.pttl(`ratelimit:${budget.name}:${caller}`),
    ).toBeGreaterThan(0);
  });

  it('peek does not count', async () => {
    const caller = key();
    await limiter.peek(budget, caller);
    expect(await limiter.peek(budget, caller)).toMatchObject({
      used: 0,
      remaining: 3,
      allowed: true,
    });
  });

  it('charges several budgets together, or none when one is spent', async () => {
    const caller = key();
    const small: Budget = { name: 'spec-small', resource: 'search', limit: 1 };
    const both = await limiter.consumeTogether(caller, [budget, small]);
    expect(both.map((decision) => decision.used)).toEqual([1, 1]);
    const refused = await limiter.consumeTogether(caller, [budget, small]);
    expect(refused.map((decision) => decision.allowed)).toEqual([true, false]);
    expect(await limiter.peek(budget, caller)).toMatchObject({ used: 1 });
  });

  it('fails closed when Redis is unreachable', async () => {
    const down = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    const unreachable = new RateLimiterService(down);
    await expect(unreachable.consume(budget, key())).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
    down.disconnect();
  });
});
