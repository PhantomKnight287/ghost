import { describe, expect, it, vi } from 'vitest';

import { AuthenticationRequiredError } from '../../../services/git/repository-access/repository-access.errors.js';
import { GitBasicAuthMiddleware } from './git-basic-auth.middleware.js';

const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

function harness({
  verify = { valid: true, key: { referenceId: 'user_owner' } },
  authorize = vi.fn(),
}: {
  verify?: unknown;
  authorize?: ReturnType<typeof vi.fn>;
} = {}) {
  const auth = { api: { verifyApiKey: vi.fn().mockResolvedValue(verify) } };
  const middleware = new GitBasicAuthMiddleware(
    auth as never,
    { authorize } as never,
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
    return req as { actor?: unknown };
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
  });

  it('passes an anonymous actor through for a public fetch', async () => {
    const { run, next, authorize } = harness();

    await run({});

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null, operation: 'read' }),
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
      expect.objectContaining({ actor: null }),
    );
  });

  it('strips the .git suffix clone URLs carry', async () => {
    const { run, authorize } = harness();

    await run({ params: { username: 'owner', repo: 'repo.git' } });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'repo' }),
    );
  });
});
