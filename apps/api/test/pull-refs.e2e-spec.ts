import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../src/database/database.module.js';
import { PullRefsModule } from '../src/pull-refs/pull-refs.module.js';
import { RepositoryMaterializerService } from '../src/services/git/materializer/repository-materializer.service.js';
import { PushTransactionService } from '../src/services/git/wal/push-transaction.service.js';
import { WalStoreService } from '../src/services/git/wal/wal-store.service.js';
import { StorageQuotaService } from '../src/services/storage/storage-quota.service.js';
import { PullRefsService } from '../src/services/git/pull-refs/pull-refs.service.js';
import { createUlid } from '../src/lib/git/wal/ulid.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('refs/pull/<n>/head and /merge', () => {
  let app: INestApplication;
  let origin: string;
  let upstream: { cookie: string; key: string };
  let forker: { cookie: string; key: string };
  let work: string;
  const owner = `pullrefs${Date.now()}`;
  const contributor = `pullfork${Date.now()}`;
  let repo: string;
  let fork: string;
  let sshPort: number;
  let sshKey: string;
  let keys: string;

  const api = () => request(app.getHttpServer());
  const pulls = (suffix = '') =>
    `/api/repositories/${owner}/${repo}/pulls${suffix}`;
  const url = (username: string, key: string, slug: string) =>
    `${origin.replace('://', `://${username}:${key}@`)}/${username}/${slug}.git`;
  const upstreamUrl = () => url(owner, upstream.key, repo);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const run = (args: string[], env: Record<string, string> = {}) =>
    promisify(execFile)('git', args, {
      cwd: work,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    });
  const commit = (branch: string, file: string, content: string) => {
    git('checkout', '-q', branch);
    writeFileSync(path.join(work, file), content);
    git('add', file);
    git('commit', '-q', '-m', `${branch}: ${file}`);
    return git('rev-parse', 'HEAD');
  };
  const pullRefs = async (target = upstreamUrl()) => {
    const { stdout } = await run(['ls-remote', target, 'refs/pull/*']);
    return Object.fromEntries(
      stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t').reverse()),
    ) as Record<string, string>;
  };
  const fetchRef = async (ref: string) => {
    await run(['fetch', '-q', upstreamUrl(), `+${ref}:refs/fetched/${ref}`]);
    return `refs/fetched/${ref}`;
  };
  const parentsOf = async (ref: string) =>
    git('log', '-1', '--format=%P', await fetchRef(ref)).split(' ');

  /** Fetches over SSH as the upstream owner, tracing the packets so a test can read which protocol was spoken. */
  const sshFetch = (version: string, refspec: string) =>
    run(
      [
        '-c',
        `protocol.version=${version}`,
        'fetch',
        `ssh://git@127.0.0.1:${sshPort}/${owner}/${repo}.git`,
        refspec,
      ],
      {
        GIT_TRACE_PACKET: '1',
        GIT_SSH_COMMAND: `ssh -i ${sshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`,
      },
    );

  beforeAll(async () => {
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-pull-refs-'));
    keys = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ssh-'));
    const hostKey = path.join(keys, 'host');
    sshKey = path.join(keys, 'client');
    for (const file of [hostKey, sshKey]) {
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]);
    }
    sshPort = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

    ({ app, origin } = await startApp({
      GIT_SSH_HOST_KEY: readFileSync(hostKey, 'utf8'),
      GIT_SSH_PORT: String(sshPort),
    }));
    upstream = await signUp(app, owner);
    forker = await signUp(app, contributor);

    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', upstream.cookie)
        .send({ name: 'upstream', visibility: 'public' })
        .expect(201)
    ).body.slug;
    await api()
      .post('/api/ssh-keys')
      .set('cookie', upstream.cookie)
      .send({ title: 'e2e', publicKey: readFileSync(`${sshKey}.pub`, 'utf8') })
      .expect(201);

    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'shared.txt'), 'shared\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    await run(['push', '-q', upstreamUrl(), 'main']);

    fork = (
      await api()
        .post(`/api/repositories/${owner}/${repo}/fork`)
        .set('cookie', forker.cookie)
        .send({ name: 'fork', visibility: 'public' })
        .expect(201)
    ).body.slug;
    git('checkout', '-q', '-b', 'feature', 'main');
    git('checkout', '-q', '-b', 'other', 'main');
    commit('feature', 'feature.txt', 'from the fork\n');
    commit('other', 'other.txt', 'another change\n');
    await run([
      'push',
      '-q',
      url(contributor, forker.key, fork),
      'feature',
      'other',
    ]);

    await api()
      .post(pulls())
      .set('cookie', forker.cookie)
      .send({ title: 'feature', base: 'main', head: `${contributor}:feature` })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    for (const directory of [work, keys]) {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  });

  it('publishes a fork request as its head and a test merge into the base', async () => {
    const feature = git('rev-parse', 'feature');
    const main = git('rev-parse', 'main');

    await vi.waitFor(
      async () => {
        const refs = await pullRefs();
        expect(refs['refs/pull/1/head']).toBe(feature);
        expect(refs['refs/pull/1/merge']).toBeDefined();
      },
      { timeout: 15_000, interval: 200 },
    );

    expect(await parentsOf('refs/pull/1/merge')).toEqual([main, feature]);
    expect(
      git('ls-tree', '--name-only', 'refs/fetched/refs/pull/1/merge').split(
        '\n',
      ),
    ).toEqual(['feature.txt', 'shared.txt']);
  });

  it('fetches over protocol v2, asking only for the prefix it wants', async () => {
    const { stderr } = await run(
      [
        '-c',
        'protocol.version=2',
        'fetch',
        upstreamUrl(),
        '+refs/pull/1/head:refs/fetched/v2',
      ],
      { GIT_TRACE_PACKET: '1' },
    );

    expect(stderr).toContain('version 2');
    expect(stderr).toContain('ref-prefix refs/pull/1/head');
    expect(stderr).not.toContain('refs/heads/main');
    expect(git('rev-parse', 'refs/fetched/v2')).toBe(
      git('rev-parse', 'feature'),
    );
  });

  it('fetches over SSH with protocol v2 when the client asks for it', async () => {
    const { stderr } = await vi.waitFor(
      () => sshFetch('2', '+refs/pull/1/head:refs/fetched/ssh-v2'),
      { timeout: 10_000, interval: 250 },
    );

    expect(stderr).toContain('version 2');
    expect(stderr).toContain('ref-prefix refs/pull/1/head');
    expect(git('rev-parse', 'refs/fetched/ssh-v2')).toBe(
      git('rev-parse', 'feature'),
    );
  });

  it('stays on v0 over SSH for a client that does not ask', async () => {
    const { stderr } = await vi.waitFor(
      () => sshFetch('0', '+refs/pull/1/head:refs/fetched/ssh-v0'),
      { timeout: 10_000, interval: 250 },
    );

    expect(stderr).not.toContain('version 2');
    expect(git('rev-parse', 'refs/fetched/ssh-v0')).toBe(
      git('rev-parse', 'feature'),
    );
  });

  it('follows the head when the fork pushes again', async () => {
    const feature = commit('feature', 'feature.txt', 'from the fork, again\n');
    await run(['push', '-q', url(contributor, forker.key, fork), 'feature']);

    await vi.waitFor(
      async () => expect((await pullRefs())['refs/pull/1/head']).toBe(feature),
      { timeout: 15_000, interval: 200 },
    );
    await vi.waitFor(
      async () =>
        expect(await parentsOf('refs/pull/1/merge')).toEqual([
          git('rev-parse', 'main'),
          feature,
        ]),
      { timeout: 15_000, interval: 200 },
    );
  });

  it('rebuilds the test merge when the base moves', async () => {
    const main = commit('main', 'upstream.txt', 'upstream moves on\n');
    await run(['push', '-q', upstreamUrl(), 'main']);

    await vi.waitFor(
      async () =>
        expect(await parentsOf('refs/pull/1/merge')).toEqual([
          main,
          git('rev-parse', 'feature'),
        ]),
      { timeout: 15_000, interval: 200 },
    );
  });

  it('drops the test merge while the request conflicts, and keeps the head', async () => {
    commit('main', 'feature.txt', 'the base claims this file\n');
    await run(['push', '-q', upstreamUrl(), 'main']);

    await vi.waitFor(
      async () => {
        const refs = await pullRefs();
        expect(refs['refs/pull/1/merge']).toBeUndefined();
        expect(refs['refs/pull/1/head']).toBe(git('rev-parse', 'feature'));
      },
      { timeout: 15_000, interval: 200 },
    );
  });

  it('refuses a client push to a pull request ref', async () => {
    await expect(
      run(['push', '-q', upstreamUrl(), 'main:refs/pull/1/head']),
    ).rejects.toThrow();
    expect((await pullRefs())['refs/pull/1/head']).toBe(
      git('rev-parse', 'feature'),
    );
  });

  it('pins a merged request to the head that merged', async () => {
    const other = git('rev-parse', 'other');
    const { body } = await api()
      .post(pulls())
      .set('cookie', forker.cookie)
      .send({ title: 'other', base: 'main', head: `${contributor}:other` })
      .expect(201);
    await api()
      .post(pulls(`/${body.number}/merge`))
      .set('cookie', upstream.cookie)
      .send({ method: 'squash' })
      .expect(201);

    await vi.waitFor(
      async () =>
        expect((await pullRefs())[`refs/pull/${body.number}/head`]).toBe(other),
      { timeout: 15_000, interval: 200 },
    );
  });

  it('clears a refusal once the refs are current again, whether or not that took a write', async () => {
    const { body } = await api().get(pulls('/1')).expect(200);
    const refuse = () =>
      app
        .get<Database>(DATABASE)
        .update(schema.pullRequest)
        .set({ pullRefsBlocked: 'refused earlier' })
        .where(eq(schema.pullRequest.id, body.id));
    const cleared = () =>
      vi.waitFor(
        async () =>
          expect(
            (await api().get(pulls('/1'))).body.pullRefsBlocked,
          ).toBeNull(),
        { timeout: 15_000, interval: 200 },
      );

    await refuse();
    app.get(PullRefsService).syncInBackground(body.id);
    await cleared();

    await refuse();
    const feature = commit('feature', 'later.txt', 'one more\n');
    await run(['push', '-q', url(contributor, forker.key, fork), 'feature']);
    await cleared();
    expect((await pullRefs())['refs/pull/1/head']).toBe(feature);
  });

  it.each([
    'accounting rollback',
    'lost WAL response',
    'lost database response',
  ])(
    'recovers a committed pack after %s without rewriting refs or double counting',
    async (failure) => {
      const { body: pull } = await api().get(pulls('/1')).expect(200);
      const db = app.get<Database>(DATABASE);
      const service = app.get(PullRefsService);
      const quota = app.get(StorageQuotaService);
      const push = app
        .select(PullRefsModule)
        .get(PushTransactionService, { strict: true });
      const store = app.get(WalStoreService);
      const writes = () =>
        db
          .select()
          .from(schema.pullRequestRefWrite)
          .where(eq(schema.pullRequestRefWrite.pullRequestId, pull.id));
      const pending = () =>
        db
          .select()
          .from(schema.pullRequestRefWritePending)
          .where(eq(schema.pullRequestRefWritePending.pullRequestId, pull.id));
      // Settle earlier background work before injecting one failure.
      await service.sync(pull.id);
      const before = await writes();
      const background = vi
        .spyOn(service, 'syncInBackground')
        .mockImplementation(() => {});
      const reserve = quota.reservePullRefWrite.bind(quota);
      const commitPush = push.commitPush.bind(push);
      const pushSpy = vi.spyOn(push, 'commitPush');
      const reservation = vi.spyOn(quota, 'reservePullRefWrite');
      try {
        commit('feature', 'recovery.txt', `${failure}\n`);
        await run([
          'push',
          '-q',
          url(contributor, forker.key, fork),
          'feature',
        ]);
        pushSpy.mockClear();
        reservation.mockClear();
        const error = new Error('injected lost transaction');
        if (failure === 'lost WAL response') {
          pushSpy.mockImplementationOnce(async (options) => {
            await commitPush(options);
            throw error;
          });
        } else {
          reservation.mockImplementationOnce(async (author, bytes, write) => {
            if (failure === 'accounting rollback') {
              return reserve(author, bytes, async (tx) => {
                await write(tx);
                throw error;
              });
            }
            await reserve(author, bytes, write);
            throw error;
          });
        }
        await expect(service.sync(pull.id)).rejects.toThrow(error.message);
        expect((await pullRefs())['refs/pull/1/head']).toBe(
          git('rev-parse', 'feature'),
        );
        const intents = await pending();
        expect(intents).toHaveLength(
          failure === 'lost database response' ? 0 : 1,
        );
        expect(await writes()).toHaveLength(
          before.length + (failure === 'lost database response' ? 1 : 0),
        );

        // A new instance has no in-memory knowledge of the failed sync.
        const restarted = new PullRefsService(
          db,
          app.get(RepositoryMaterializerService),
          push,
          quota,
          store,
        );
        await restarted.sync(pull.id);
        const after = await writes();
        expect(after).toHaveLength(before.length + 1);
        const added = after.find(
          (row) => !before.some(({ id }) => row.id === id),
        )!;
        const [storedPull] = await db
          .select()
          .from(schema.pullRequest)
          .where(eq(schema.pullRequest.id, pull.id));
        const index = await store.readIndex(storedPull.baseRepositoryId);
        expect(added.size).toBe(
          index!.index.layers.find(({ ulid }) => `prw_${ulid}` === added.id)!
            .size,
        );
        expect(added.size).toBeGreaterThan(0);
        expect(await pending()).toHaveLength(0);

        // A stale recovery attempt may still see an intent already accounted for.
        await db
          .insert(schema.pullRequestRefWritePending)
          .values({ id: added.id.slice(4), pullRequestId: pull.id });
        await restarted.sync(pull.id);
        expect(await writes()).toHaveLength(after.length);
        expect(await pending()).toHaveLength(0);
        expect(pushSpy).toHaveBeenCalledTimes(1);
        expect(reservation).toHaveBeenCalledTimes(1);
      } finally {
        background.mockRestore();
        pushSpy.mockRestore();
        reservation.mockRestore();
      }
    },
    30_000,
  );

  it('forgets an intent that never reached the log once it is past its grace, and keeps a young one', async () => {
    const { body: pull } = await api().get(pulls('/1')).expect(200);
    const db = app.get<Database>(DATABASE);
    const abandoned = createUlid(Date.now() - 2 * 60 * 60 * 1000);
    const young = createUlid();
    await db.insert(schema.pullRequestRefWritePending).values([
      { id: abandoned, pullRequestId: pull.id },
      { id: young, pullRequestId: pull.id },
    ]);

    await app.get(PullRefsService).sync(pull.id);

    const left = await db
      .select({ id: schema.pullRequestRefWritePending.id })
      .from(schema.pullRequestRefWritePending)
      .where(eq(schema.pullRequestRefWritePending.pullRequestId, pull.id));
    expect(left).toEqual([{ id: young }]);
    await db
      .delete(schema.pullRequestRefWritePending)
      .where(eq(schema.pullRequestRefWritePending.id, young));
  });

  it('leaves pull request refs behind when the repository is forked', async () => {
    const username = `pulllate${Date.now()}`;
    const later = await signUp(app, username);
    const { body } = await api()
      .post(`/api/repositories/${owner}/${repo}/fork`)
      .set('cookie', later.cookie)
      .send({ name: 'late', visibility: 'public' })
      .expect(201);

    expect(await pullRefs(url(username, later.key, body.slug))).toEqual({});
  });
});
