import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { rateLimitBudgets } from './budgets.js';

describe('rateLimitBudgets', () => {
  it('uses the documented defaults when nothing is set', () => {
    const budgets = rateLimitBudgets(new ConfigService({}));
    expect(
      Object.fromEntries(
        Object.entries(budgets).map(([name, budget]) => [name, budget.limit]),
      ),
    ).toEqual({
      core: 120,
      coreAnonymous: 30,
      search: 30,
      signIn: 5,
      failedSignIn: 3,
      signUp: 3,
      web: 300,
      webAnonymous: 120,
      git: 60,
      badToken: 20,
    });
  });

  it('reads each limit from its env var', () => {
    const budgets = rateLimitBudgets(
      new ConfigService({
        RATE_LIMIT_PER_MINUTE: '7',
        RATE_LIMIT_GIT_PER_MINUTE: '9',
      }),
    );
    expect(budgets.core.limit).toBe(7);
    expect(budgets.git.limit).toBe(9);
  });
});
