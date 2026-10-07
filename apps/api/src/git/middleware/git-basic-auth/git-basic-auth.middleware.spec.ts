import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { signLfsToken } from '../../../lib/git/lfs/lfs-token.js';
import { AuthenticationRequiredError } from '../../../lib/repositories/access/repository-access.errors.js';
import { GitBasicAuthMiddleware } from './git-basic-auth.middleware.js';

const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const SECRET = 'lfs-secret';
const bearer = (operation: 'download' | 'upload', repositoryId = 'repo_1') =>
  `Bearer ${signLfsToken(SECRET, { userId: 'user_owner', repositoryId, operation, expiresAt: Date.now() + 60_000 })}`;
const LFS_BATCH = '/owner/repo/info/lfs/objects/batch';

function harness({
  verify = { valid: true, key: { id: 'key_1', referenceId: 'user_owner' } },
  authorize = vi.fn().mockResolvedValue({ id: 'repo_1' }),
}: {
  verify?: unknown;
  authorize?: ReturnType<typeof vi.fn>;
} = {}) {
  const auth = { api: { verifyApiKey: vi.fn().mockResolvedValue(verify) } };
  const middleware = new GitBasicAuthMiddleware(
    auth as never,
    { authorize } as never,
    new ConfigService({ BETTER_AUTH_SECRET: SECRET }),
  );

  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  const next = vi.fn();

  const run = async (overrides: Record<string, unknown>) => {
    const req = {
      params: { username: 'owner', repo: 'repo' },
      headers: {},
      query: {},
      path: '/owner/repo/info/refs',
      ...overrides,
    };
    await middleware.use(req as never, res as never, next);
    return req as { actor?: unknown; apiKeyId?: unknown };
  };

  return { run, res, next, auth, authorize };
}

describe('GitBasicAuthMiddleware', () => {
  it('lets an authorized request through with the resolved actor', async () => {
    const { run, next } = harness();

    const req = await run({
      headers: { authorization: basic('anything', 'ghost_pat_k') },
    });

    expect(next).toHaveBeenCalledWith();
    expect(req.actor).toEqual({ userId: 'user_owner' });
    expect(req.apiKeyId).toBe('key_1');
  });

  it('passes an anonymous actor through for a public fetch', async () => {
    const { run, next, authorize } = harness();

    await run({});

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ requesterId: undefined, operation: 'read' }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('challenges instead of failing when authorization needs an identity', async () => {
    const { run, res, next } = harness({
      authorize: vi.fn().mockRejectedValue(new AuthenticationRequiredError()),
    });

    await run({});

    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="Ghost"',
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards every other failure to the error filter', async () => {
    const error = new Error('boom');
    const { run, res, next } = harness({
      authorize: vi.fn().mockRejectedValue(error),
    });

    await run({});

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('treats a push and its ref advertisement as a write', async () => {
    for (const req of [
      { path: '/owner/repo/git-receive-pack' },
      { query: { service: 'git-receive-pack' } },
    ]) {
      const { run, authorize } = harness();
      await run(req);
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'write' }),
      );
    }
  });

  it('keeps a colon in the key and ignores the username', async () => {
    const { run, auth } = harness();

    await run({ headers: { authorization: basic('git', 'ghost_pat_a:b') } });

    expect(auth.api.verifyApiKey).toHaveBeenCalledWith({
      body: { key: 'ghost_pat_a:b' },
    });
  });

  it('treats an invalid key as no credentials at all', async () => {
    const { run, authorize } = harness({ verify: { valid: false, key: null } });

    await run({ headers: { authorization: basic('git', 'revoked') } });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ requesterId: undefined }),
    );
  });

  it('strips the .git suffix clone URLs carry', async () => {
    const { run, authorize } = harness();

    await run({ params: { username: 'owner', repo: 'repo.git' } });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'repo' }),
    );
  });

  it('treats an LFS upload, PUT and lock change as a write', async () => {
    for (const req of [
      { path: LFS_BATCH, body: { operation: 'upload' } },
      { path: '/owner/repo/info/lfs/objects/abc', method: 'PUT' },
      { path: '/owner/repo/info/lfs/locks/verify', method: 'POST' },
    ]) {
      const { run, authorize } = harness();
      await run(req);
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'write' }),
      );
    }
  });

  it('accepts a git-lfs-authenticate token on the LFS API of its repository', async () => {
    const { run, next } = harness();

    const req = await run({
      path: LFS_BATCH,
      method: 'POST',
      body: { operation: 'upload' },
      headers: { authorization: bearer('upload') },
    });

    expect(next).toHaveBeenCalledWith();
    expect(req.actor).toEqual({ userId: 'user_owner' });
  });

  it('refuses a token outside its scope', async () => {
    for (const req of [
      {
        path: '/owner/repo/git-receive-pack',
        headers: { authorization: bearer('upload') },
      },
      {
        path: LFS_BATCH,
        headers: { authorization: bearer('download', 'repo_2') },
      },
      {
        path: LFS_BATCH,
        body: { operation: 'upload' },
        headers: { authorization: bearer('download') },
      },
    ]) {
      const { run, res, next } = harness();
      await run(req);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('treats a forged or expired token as no credentials at all', async () => {
    const expired = `Bearer ${signLfsToken(SECRET, { userId: 'user_owner', repositoryId: 'repo_1', operation: 'download', expiresAt: Date.now() - 1 })}`;
    const forged = `Bearer ${signLfsToken('other', { userId: 'user_owner', repositoryId: 'repo_1', operation: 'download', expiresAt: Date.now() + 60_000 })}`;
    for (const authorization of [expired, forged]) {
      const { run, authorize } = harness();
      await run({ path: LFS_BATCH, headers: { authorization } });
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ requesterId: undefined }),
      );
    }
  });
});
