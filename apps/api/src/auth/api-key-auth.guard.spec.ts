import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { ApiKeyAuthGuard } from './api-key-auth.guard.js';

const user = { id: 'user_1', name: 'Owner' };
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
}: {
  authorization?: string;
  verify?: { valid: boolean; key: ReturnType<typeof key> | null };
  flags?: string[];
}) {
  const request: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };
  const getSession = vi.fn().mockResolvedValue(null);
  const verifyApiKey = vi.fn().mockResolvedValue(verify);
  const instance = {
    api: { getSession, verifyApiKey },
    $context: Promise.resolve({
      internalAdapter: { findUserById: vi.fn().mockResolvedValue(user) },
    }),
  };
  const reflector = {
    getAllAndOverride: (flag: string) => flags.includes(flag),
  } as unknown as Reflector;
  const guard = new ApiKeyAuthGuard(reflector, { auth: instance } as never);
  const context = {
    getType: () => 'http',
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

  it('leaves tokens on optional routes to their own auth, as git and LFS do', async () => {
    const { guard, context, verifyApiKey } = setup({
      authorization: 'Bearer lfs-token',
      flags: ['OPTIONAL'],
    });
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
