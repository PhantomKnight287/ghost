import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe.skipIf(!hasBackends)('Rate limits on git', () => {
  let app: INestApplication;
  let keys: string;
  let sshKey: string;
  let sshPort: number;
  let accounts = 0;
  const http = () => request(app.getHttpServer());

  /** A fresh account with a public repository, so each test starts with the whole git budget. */
  const account = async () => {
    const username = `rlgit${Date.now()}x${accounts++}`;
    const owner = await signUp(app, username);
    await http()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'repo', visibility: 'public' })
      .expect(201);
    const basic = `Basic ${Buffer.from(`x:${owner.key}`).toString('base64')}`;
    return { username, basic, ...owner };
  };
  const infoRefs = (username: string, authorization?: string) => {
    const call = http().get(
      `/${username}/repo.git/info/refs?service=git-upload-pack`,
    );
    return authorization ? call.set('authorization', authorization) : call;
  };

  beforeAll(async () => {
    keys = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-git-rate-limit-'));
    const hostKey = path.join(keys, 'host');
    sshKey = path.join(keys, 'client');
    for (const file of [hostKey, sshKey])
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]);
    sshPort = await freePort();
    ({ app } = await startApp({
      RATE_LIMIT_GIT_PER_MINUTE: '3',
      GIT_SSH_HOST_KEY: readFileSync(hostKey, 'utf8'),
      GIT_SSH_PORT: String(sshPort),
    }));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (keys) rmSync(keys, { recursive: true, force: true });
  });

  it('limits git over HTTP per account', async () => {
    const { username, basic } = await account();
    for (let i = 0; i < 3; i++) {
      const response = await infoRefs(username, basic).expect(200);
      expect(response.headers['x-ratelimit-resource']).toBe('git');
    }
    const refused = await infoRefs(username, basic).expect(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(refused.headers['content-type']).toMatch(/^text\/plain/);
    expect(refused.text).toMatch(
      /^API rate limit exceeded; try again in \d+ seconds\n$/,
    );
    expect(refused.headers['www-authenticate']).toBeUndefined();
  });

  it('does not count LFS object transfers', async () => {
    const { username, basic } = await account();
    for (let i = 0; i < 3; i++) await infoRefs(username, basic).expect(200);
    const transfer = await http()
      .get(`/${username}/repo.git/info/lfs/objects/${'0'.repeat(64)}`)
      .set('authorization', basic);
    expect(transfer.status).not.toBe(429);
  });

  it('shares the git budget with SSH', async () => {
    const { username, basic, cookie } = await account();
    await http()
      .post('/api/ssh-keys')
      .set('cookie', cookie)
      .send({ title: 'e2e', publicKey: readFileSync(`${sshKey}.pub`, 'utf8') })
      .expect(201);
    for (let i = 0; i < 2; i++) await infoRefs(username, basic).expect(200);
    // The server runs in this process, so git must not block the event loop.
    const lsRemote = () =>
      promisify(execFile)(
        'git',
        ['ls-remote', `ssh://git@127.0.0.1:${sshPort}/${username}/repo.git`],
        {
          env: {
            ...process.env,
            GIT_SSH_COMMAND: `ssh -i ${sshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`,
          },
        },
      );
    await lsRemote();
    await expect(lsRemote()).rejects.toMatchObject({
      stderr: expect.stringContaining('API rate limit exceeded'),
    });
  });

  it('counts anonymous HTTP clones by IP', async () => {
    const { username } = await account();
    const response = await infoRefs(username);
    expect(response.headers['x-ratelimit-limit']).toBe('3');
    expect(response.headers['x-ratelimit-resource']).toBe('git');
  });

  it('does not touch the API budget', async () => {
    const { username, basic, key } = await account();
    const used = async () =>
      Number(
        (
          await http()
            .get('/api/notifications')
            .set('authorization', `Bearer ${key}`)
            .expect(200)
        ).headers['x-ratelimit-used'],
      );
    const before = await used();
    for (let i = 0; i < 2; i++) await infoRefs(username, basic).expect(200);
    expect(await used()).toBe(before + 1);
  });
});
