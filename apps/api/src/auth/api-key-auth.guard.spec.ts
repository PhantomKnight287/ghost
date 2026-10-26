import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { ApiKeyRateLimitedError } from '../lib/api-keys/api-keys.errors.js';
import {
  Anonymous,
  ApiKeyAuthGuard,
  SignInOptional,
} from './api-key-auth.guard.js';

const user = { id: 'user_1', name: 'Owner', emailVerified: true };
const key = (permissions: Record<string, string[]> | null = null) => ({
  id: 'key_1',
  referenceId: 'user_1',
  permissions,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function setup({
  authorization,
  verify = { valid: true, key: key() },
  flags = [] as string[],
  verification = false,
  owner = user as typeof user | null,
  type = 'http',
}: {
  authorization?: string;
  verify?: {
    valid: boolean;
    key: ReturnType<typeof key> | null;
    error?: object;
  };
  flags?: string[];
  verification?: boolean;
  owner?: typeof user | null;
  type?: string;
}) {
  const request: { headers: Record<string, string>; [field: string]: unknown } =
    {
      headers: authorization ? { authorization } : {},
    };
  const getSession = vi.fn().mockResolvedValue(null);
  const verifyApiKey = vi.fn().mockResolvedValue(verify);
  const instance = {
    api: { getSession, verifyApiKey },
    $context: Promise.resolve({
      internalAdapter: { findUserById: vi.fn().mockResolvedValue(owner) },
      options: {
        emailAndPassword: { requireEmailVerification: verification },
      },
    }),
  };
  const reflector = {
    getAllAndOverride: (flag: string) => flags.includes(flag),
  } as unknown as Reflector;
  const guard = new ApiKeyAuthGuard(reflector, { auth: instance } as never);
  const context = {
    getType: () => type,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
  return { guard, context, request, getSession, verifyApiKey };
}

describe('ApiKeyAuthGuard', () => {
  it('signs a personal access token in as its owner, without the key as a session token', async () => {
    const { guard, context, request } = setup({
      authorization: 'Bearer ghost_pat_abc',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(user);
    const session = request.session as { session: Record<string, unknown> };
    expect(session.session.userId).toBe('user_1');
    expect(JSON.stringify(session)).not.toContain('ghost_pat_abc');
  });

  it('accepts gh’s `token` scheme too', async () => {
    const { guard, context, verifyApiKey } = setup({
      authorization: 'token ghost_pat_abc',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith({
      body: { key: 'ghost_pat_abc' },
    });
  });

  it('refuses a bad key', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer nope',
      verify: { valid: false, key: null },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses OAuth app tokens, which carry scopes', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer ghost_pat_abc',
      verify: { valid: true, key: key({ scopes: ['repo'] }) },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a key on a cookie-only route', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer ghost_pat_abc',
      flags: ['COOKIE_ONLY'],
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('signs a token in on an optional route', async () => {
    const { guard, context, request } = setup({
      authorization: 'Bearer ghost_pat_abc',
      flags: ['OPTIONAL'],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  it('leaves requests git already authenticated alone', async () => {
    const { guard, context, request, verifyApiKey } = setup({
      authorization: 'Bearer lfs-token',
      flags: ['OPTIONAL'],
    });
    request.actor = null;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it('leaves requests the GitHub middleware authenticated alone', async () => {
    const { guard, context, request, verifyApiKey } = setup({
      authorization: 'Bearer ghost_pat_abc',
      flags: ['PUBLIC'],
    });
    request.githubViewer = null;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it('falls back to the session cookie without a token', async () => {
    const { guard, context, getSession, verifyApiKey } = setup({});
    await expect(guard.canActivate(context)).rejects.toThrow();
    expect(getSession).toHaveBeenCalled();
    expect(verifyApiKey).not.toHaveBeenCalled();
  });
});

describe('ApiKeyAuthGuard checks', () => {
  it('refuses an unverified owner when verification is required', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer ghost_pat_abc',
      verification: true,
      owner: { ...user, emailVerified: false },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets an unverified owner in where mail is not configured', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer ghost_pat_abc',
      owner: { ...user, emailVerified: false },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throttles an address after 20 bad tokens', async () => {
    const { guard, context, verifyApiKey } = setup({
      authorization: 'Bearer nope',
      verify: { valid: false, key: null },
    });
    for (let i = 0; i < 20; i++)
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(verifyApiKey).toHaveBeenCalledTimes(20);
  });

  it('answers a good key over its budget as rate limited, without counting it as a bad token', async () => {
    const { guard, context, verifyApiKey } = setup({
      authorization: 'Bearer ghost_pat_abc',
      verify: {
        valid: false,
        key: null,
        error: { code: 'RATE_LIMITED', details: { tryAgainIn: 30_000 } },
      },
    });
    for (let i = 0; i < 21; i++)
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ApiKeyRateLimitedError,
      );
    expect(verifyApiKey).toHaveBeenCalledTimes(21);
  });
});

describe('ApiKeyAuthGuard edges', () => {
  it('leaves non-HTTP requests to the session cookie', async () => {
    const { guard, context, verifyApiKey } = setup({
      authorization: 'Bearer ghost_pat_abc',
      type: 'graphql',
    });
    await expect(guard.canActivate(context)).rejects.toThrow();
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it('signs a token in on a public route', async () => {
    const { guard, context, request } = setup({
      authorization: 'Bearer ghost_pat_abc',
      flags: ['PUBLIC'],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  it('refuses a bad token on a public route', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer nope',
      verify: { valid: false, key: null },
      flags: ['PUBLIC'],
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a key whose owner is gone', async () => {
    const { guard, context } = setup({
      authorization: 'Bearer ghost_pat_abc',
      owner: null,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lets a throttled address back in once the window passes', async () => {
    vi.useFakeTimers();
    try {
      const { guard, context } = setup({
        authorization: 'Bearer nope',
        verify: { valid: false, key: null },
      });
      for (let i = 0; i < 20; i++)
        await guard.canActivate(context).catch(() => undefined);
      vi.advanceTimersByTime(60_000);
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts each X-Real-IP apart on Railway, and ignores the header elsewhere', async () => {
    const { guard, context, request } = setup({
      authorization: 'Bearer nope',
      verify: { valid: false, key: null },
    });
    request.headers['x-real-ip'] = '203.0.113.1';
    for (let i = 0; i < 20; i++)
      await guard.canActivate(context).catch(() => undefined);
    request.headers['x-real-ip'] = '203.0.113.2';
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });

    vi.stubEnv('RAILWAY_SERVICE_ID', 'svc');
    try {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('sign-in decorators', () => {
  class Routes {
    @Anonymous()
    open() {}

    @SignInOptional()
    either() {}
  }

  it('shows anonymous routes with no sign-in in the reference', () => {
    expect(
      Reflect.getMetadata('swagger/apiSecurity', Routes.prototype.open),
    ).toEqual([{}]);
    expect(Reflect.getMetadata('PUBLIC', Routes.prototype.open)).toBe(true);
  });

  it('shows optional routes as anonymous, token or session in the reference', () => {
    expect(
      Reflect.getMetadata('swagger/apiSecurity', Routes.prototype.either),
    ).toEqual([{}, { token: [] }, { session: [] }]);
    expect(Reflect.getMetadata('OPTIONAL', Routes.prototype.either)).toBe(true);
  });
});
