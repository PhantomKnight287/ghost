import type { ConfigService } from '@nestjs/config';

export type RateLimitResource = 'core' | 'search' | 'auth' | 'git' | 'web';
export type Budget = {
  name: string;
  resource: RateLimitResource;
  limit: number;
};
export type Budgets = Record<
  | 'core'
  | 'coreAnonymous'
  | 'search'
  | 'signIn'
  | 'failedSignIn'
  | 'signUp'
  | 'web'
  | 'webAnonymous'
  | 'git'
  | 'badToken',
  Budget
>;

/** Bad tokens one address may send a minute; fixed, as it guards against guessing rather than pacing real clients. */
export const BAD_TOKEN_BUDGET: Budget = {
  name: 'bad-token',
  resource: 'auth',
  limit: 20,
};

export function rateLimitBudgets(config: ConfigService): Budgets {
  const limit = (name: string, fallback: number) =>
    Number(config.get<string>(name) || fallback);
  return {
    core: {
      name: 'core',
      resource: 'core',
      limit: limit('RATE_LIMIT_PER_MINUTE', 120),
    },
    coreAnonymous: {
      name: 'core-anonymous',
      resource: 'core',
      limit: limit('RATE_LIMIT_ANONYMOUS_PER_MINUTE', 30),
    },
    search: {
      name: 'search',
      resource: 'search',
      limit: limit('RATE_LIMIT_SEARCH_PER_MINUTE', 30),
    },
    signIn: {
      name: 'sign-in',
      resource: 'auth',
      limit: limit('RATE_LIMIT_SIGN_IN_PER_MINUTE', 5),
    },
    failedSignIn: {
      name: 'failed-sign-in',
      resource: 'auth',
      limit: limit('RATE_LIMIT_FAILED_SIGN_IN_PER_MINUTE', 3),
    },
    signUp: {
      name: 'sign-up',
      resource: 'auth',
      limit: limit('RATE_LIMIT_SIGN_UP_PER_MINUTE', 3),
    },
    web: {
      name: 'web',
      resource: 'web',
      limit: limit('RATE_LIMIT_WEB_PER_MINUTE', 300),
    },
    webAnonymous: {
      name: 'web-anonymous',
      resource: 'web',
      limit: limit('RATE_LIMIT_WEB_ANONYMOUS_PER_MINUTE', 120),
    },
    git: {
      name: 'git',
      resource: 'git',
      limit: limit('RATE_LIMIT_GIT_PER_MINUTE', 60),
    },
    badToken: BAD_TOKEN_BUDGET,
  };
}
