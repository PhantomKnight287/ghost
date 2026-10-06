import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../src/database/database.module.js';
import { lfsObjectKey } from '../src/lib/git/lfs/lfs-objects.js';
import { S3Service } from '../src/services/s3/s3.service.js';
import { hasBackends, signUp, startApp } from './harness.js';

const LFS = 'application/vnd.git-lfs+json';
const hasGitLfs = spawnSync('git', ['lfs', 'version']).status === 0;

/** A port nothing listens on, so the app's own URL, which the batch API's hrefs start with, can be known before it starts. */
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The protocol as git-lfs speaks it: a batch request, then the `basic` transfer's PUT and GET on the hrefs it hands back. */
describe.skipIf(!hasBackends)('Git LFS', () => {
  let app: INestApplication;
  let origin: string;
  let work: string;
  let keys: string;
  let sshKey: string;
  let sshPort: number;
  let owner: Awaited<ReturnType<typeof signUp>>;
  let forker: Awaited<ReturnType<typeof signUp>>;
  const stamp = Date.now();
  const ownerName = `lfsowner${stamp}`;
  const forkerName = `lfsforker${stamp}`;
  let repo: string;

  const file = randomBytes(512);
  const oid = createHash('sha256').update(file).digest('hex');

  const api = () => request(app.getHttpServer());
  const basic = (username: string, key: string) =>
    `Basic ${Buffer.from(`${username}:${key}`).toString('base64')}`;
  const batch = (
    path: string,
    operation: 'download' | 'upload',
    objects: { oid: string; size: number }[],
    authorization?: string,
  ) => {
    const call = api()
      .post(`/${path}.git/info/lfs/objects/batch`)
      .set('accept', LFS)
      .set('content-type', LFS);
    if (authorization) call.set('authorization', authorization);
    return call.send(
      JSON.stringify({ operation, transfers: ['basic'], objects }),
    );
  };
  const put = (
    path: string,
    objectId: string,
    bytes: Buffer,
    authorization = basic(ownerName, owner.key),
  ) =>
    api()
      .put(`/${path}.git/info/lfs/objects/${objectId}`)
      .set('authorization', authorization)
      .set('content-type', 'application/octet-stream')
      .send(bytes);
  const bytesOf = (call: request.Test) =>
    call
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .then((response) => response.body as Buffer);
  const sha256 = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const pointer = (objectId: string, size: number) =>
    `version https://git-lfs.github.com/spec/v1\noid sha256:${objectId}\nsize ${size}\n`;
  const remote = (username: string, key: string, slug: string) =>
    `${origin.replace('://', `://${username}:${key}@`)}/${username}/${slug}.git`;
  const sshCommand = () =>
    `ssh -i ${sshKey} -p ${sshPort} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
  // The machine's own git config, such as a global `git lfs install`, must not change what a test pushes.
  const gitEnv = () => ({
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: sshCommand(),
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd, encoding: 'utf8', env: gitEnv() },
    );
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const run = (cwd: string, ...args: string[]) =>
    promisify(execFile)('git', args, { cwd, env: gitEnv() });
  const usage = (cookie: string, account: string) =>
    api()
      .get(`/api/storage/${account}`)
      .set('cookie', cookie)
      .expect(200)
      .then((response) => response.body);

  beforeAll(async () => {
    keys = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-lfs-ssh-'));
    const hostKey = path.join(keys, 'host');
    sshKey = path.join(keys, 'client');
    for (const file of [hostKey, sshKey]) {
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]);
    }
    const port = await freePort();
    sshPort = await freePort();
    ({ app, origin } = await startApp(
      {
        LFS_STORAGE_QUOTA_BYTES: '1kb',
        BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
        GIT_SSH_HOST_KEY: readFileSync(hostKey, 'utf8'),
        GIT_SSH_PORT: String(sshPort),
      },
      port,
    ));
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-lfs-'));
    owner = await signUp(app, ownerName);
    forker = await signUp(app, forkerName);
    await api()
      .post('/api/ssh-keys')
      .set('cookie', owner.cookie)
      .send({ title: 'e2e', publicKey: readFileSync(`${sshKey}.pub`, 'utf8') })
      .expect(201);
    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'lfs', visibility: 'public' })
        .expect(201)
    ).body.slug;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    for (const directory of [work, keys]) {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  });

  it('challenges an anonymous upload, so git-lfs asks for credentials', async () => {
    await batch(`${ownerName}/${repo}`, 'upload', [{ oid, size: 512 }]).expect(
      401,
    );
  });

  it('hands out an upload action carrying the request’s credentials', async () => {
    const authorization = basic(ownerName, owner.key);
    const { body, headers } = await batch(
      `${ownerName}/${repo}`,
      'upload',
      [{ oid, size: 512 }],
      authorization,
    ).expect(200);

    expect(headers['content-type']).toMatch(LFS);
    expect(body.transfer).toBe('basic');
    expect(body.objects[0].actions.upload).toEqual({
      href: `${origin}/${ownerName}/${repo}.git/info/lfs/objects/${oid}`,
      header: { Authorization: authorization },
    });
  });

  it('refuses bytes that do not hash to the oid, and keeps nothing of them', async () => {
    const { body } = await put(
      `${ownerName}/${repo}`,
      oid,
      randomBytes(512),
    ).expect(422);
    expect(body.message).toMatch(/hash to/);

    const download = await batch(`${ownerName}/${repo}`, 'download', [
      { oid, size: 512 },
    ]).expect(200);
    expect(download.body.objects[0].error.code).toBe(404);
  });

  it('stores an upload, then offers it for download and asks for it no more', async () => {
    await put(`${ownerName}/${repo}`, oid, file).expect(200);

    const upload = await batch(
      `${ownerName}/${repo}`,
      'upload',
      [{ oid, size: 512 }],
      basic(ownerName, owner.key),
    ).expect(200);
    expect(upload.body.objects[0]).toEqual({ oid, size: 512 });

    const download = await batch(`${ownerName}/${repo}`, 'download', [
      { oid, size: 512 },
    ]).expect(200);
    const { href } = download.body.objects[0].actions.download;
    const body = await bytesOf(api().get(new URL(href).pathname));
    expect(Buffer.compare(body, file)).toBe(0);
  });

  it('bills uploads against the LFS quota and refuses one past it', async () => {
    const usageBefore = await usage(owner.cookie, ownerName);
    expect(usageBefore.lfs).toEqual({ usedBytes: 512, quotaBytes: 1024 });
    expect(usageBefore.usedBytes).toBe(0);

    const large = randomBytes(768);
    const { body } = await put(
      `${ownerName}/${repo}`,
      createHash('sha256').update(large).digest('hex'),
      large,
    ).expect(413);
    expect(body.message).toMatch(/Storage quota exceeded/);
  });

  it('copies objects into a fork, billed to the forker’s fork limit, and removes them with it', async () => {
    const { body: fork } = await api()
      .post(`/api/repositories/${ownerName}/${repo}/fork`)
      .set('cookie', forker.cookie)
      .send({ name: 'lfs', visibility: 'public' })
      .expect(201);

    const { lfs, fork: forkUsage } = await usage(forker.cookie, forkerName);
    expect(lfs.usedBytes).toBe(0);
    expect(forkUsage.usedBytes).toBe(512);
    await api()
      .get(`/${forkerName}/${fork.slug}.git/info/lfs/objects/${oid}`)
      .expect(200);

    await api()
      .delete(`/api/repositories/${forkerName}/${fork.slug}`)
      .set('cookie', forker.cookie)
      .expect((response) => expect(response.status).toBeLessThan(300));
    const s3 = app.get(S3Service);
    const { KeyCount } = await s3.listObjectsV2({
      Bucket: s3.bucket,
      Prefix: lfsObjectKey(fork.id),
    });
    expect(KeyCount).toBe(0);
  });

  it.skipIf(!hasGitLfs)(
    'round-trips a file through the git-lfs client',
    async () => {
      const { body: created } = await api()
        .post('/api/repositories')
        .set('cookie', forker.cookie)
        .send({ name: 'lfs-client', visibility: 'private' })
        .expect(201);
      const target = remote(forkerName, forker.key, created.slug);
      const pushed = path.join(work, 'pushed');

      git(work, 'init', '-q', '-b', 'main', pushed);
      git(pushed, 'lfs', 'install', '--local');
      git(pushed, 'lfs', 'track', '*.bin');
      const contents = randomBytes(300);
      writeFileSync(path.join(pushed, 'model.bin'), contents);
      git(pushed, 'add', '.');
      git(pushed, 'commit', '-q', '-m', 'model');
      await run(pushed, 'push', '-q', target, 'main');

      // `-c` rather than `git lfs install`, which would write to the global config.
      await run(
        work,
        '-c',
        'filter.lfs.process=git-lfs filter-process',
        '-c',
        'filter.lfs.required=true',
        'clone',
        '-q',
        target,
        'cloned',
      );
      const cloned = readFileSync(path.join(work, 'cloned', 'model.bin'));
      expect(Buffer.compare(cloned, contents)).toBe(0);
      expect((await usage(forker.cookie, forkerName)).lfs.usedBytes).toBe(300);
    },
    60_000,
  );

  it('hands SSH users an HTTPS endpoint and a token scoped to the repository', async () => {
    const { stdout } = await promisify(execFile)('ssh', [
      ...sshCommand().split(' ').slice(1),
      'git@127.0.0.1',
      `git-lfs-authenticate ${ownerName}/${repo}.git upload`,
    ]);
    const { href, header, expires_in } = JSON.parse(stdout);
    expect(href).toBe(`${origin}/${ownerName}/${repo}.git/info/lfs`);
    expect(expires_in).toBe(3600);

    const { body } = await batch(
      `${ownerName}/${repo}`,
      'upload',
      [{ oid: sha256(Buffer.from('ssh')), size: 3 }],
      header.Authorization,
    ).expect(200);
    expect(body.objects[0].actions.upload.header).toEqual(header);
  });

  it('copies the objects a merged pull request from a fork points at, and serves files as their objects', async () => {
    const main = path.join(work, 'merge');
    git(work, 'init', '-q', '-b', 'main', main);
    writeFileSync(path.join(main, 'README.md'), 'lfs\n');
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'readme');
    await run(main, 'push', '-q', remote(ownerName, owner.key, repo), 'main');

    const { body: fork } = await api()
      .post(`/api/repositories/${ownerName}/${repo}/fork`)
      .set('cookie', forker.cookie)
      .send({ name: 'lfs', visibility: 'public' })
      .expect(201);
    const asset = randomBytes(300);
    await put(
      `${forkerName}/${fork.slug}`,
      sha256(asset),
      asset,
      basic(forkerName, forker.key),
    ).expect(200);

    git(main, 'switch', '-q', '-c', 'feature');
    writeFileSync(path.join(main, 'asset.bin'), pointer(sha256(asset), 300));
    writeFileSync(
      path.join(main, '.gitattributes'),
      '*.bin filter=lfs diff=lfs merge=lfs -text\n',
    );
    // A pointer to an object nobody uploaded, outside what .gitattributes tracks so a clone can still check it out.
    writeFileSync(path.join(main, 'lost.dat'), pointer('0'.repeat(64), 9));
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'asset');
    await run(
      main,
      'push',
      '-q',
      remote(forkerName, forker.key, fork.slug),
      'feature',
    );

    const { body: pull } = await api()
      .post(`/api/repositories/${ownerName}/${repo}/pulls`)
      .set('cookie', forker.cookie)
      .send({ title: 'asset', base: 'main', head: `${forkerName}:feature` })
      .expect(201);
    await api()
      .post(`/api/repositories/${ownerName}/${repo}/pulls/${pull.number}/merge`)
      .set('cookie', owner.cookie)
      .send({ method: 'merge' })
      .expect(201);

    const download = await batch(`${ownerName}/${repo}`, 'download', [
      { oid: sha256(asset), size: 300 },
    ]).expect(200);
    expect(download.body.objects[0].actions.download).toBeDefined();
    expect((await usage(owner.cookie, ownerName)).lfs.usedBytes).toBe(812);

    const blob = (path: string) =>
      api()
        .get(`/api/repositories/${ownerName}/${repo}/blob`)
        .query({ path })
        .expect(200)
        .then((response) => response.body);
    const stored = await blob('asset.bin');
    expect(stored).toMatchObject({
      lfs: 'stored',
      size: 300,
      encoding: 'base64',
    });
    expect(Buffer.from(stored.content, 'base64').equals(asset)).toBe(true);
    expect(await blob('lost.dat')).toMatchObject({
      lfs: 'missing',
      encoding: 'utf-8',
    });
    expect((await blob('README.md')).lfs).toBeNull();

    const raw = await bytesOf(
      api()
        .get(`/api/repositories/${ownerName}/${repo}/raw`)
        .query({ path: 'asset.bin' }),
    );
    expect(raw.equals(asset)).toBe(true);
  });

  it.skipIf(!hasGitLfs)(
    'clones over SSH, with git-lfs falling back to git-lfs-authenticate',
    async () => {
      await run(
        work,
        '-c',
        'filter.lfs.process=git-lfs filter-process',
        '-c',
        'filter.lfs.required=true',
        'clone',
        '-q',
        `ssh://git@127.0.0.1:${sshPort}/${ownerName}/${repo}.git`,
        'ssh-cloned',
      );
      const contents = readFileSync(path.join(work, 'ssh-cloned', 'asset.bin'));
      expect(contents.length).toBe(300);
    },
    60_000,
  );

  it('locks a path for one person, which others see and cannot undo', async () => {
    await app
      .get<Database>(DATABASE)
      .insert(schema.repositoryCollaborator)
      .values({
        repositoryId: (
          await app
            .get<Database>(DATABASE)
            .select({ id: schema.repository.id })
            .from(schema.repository)
            .where(eq(schema.repository.ownerId, owner.userId))
        )[0].id,
        userId: forker.userId,
        role: 'write',
        acceptedAt: new Date(),
      });
    const locks = (suffix: string, authorization: string, body: object) =>
      api()
        .post(`/${ownerName}/${repo}.git/info/lfs/locks${suffix}`)
        .set('authorization', authorization)
        .set('content-type', LFS)
        .send(JSON.stringify(body));
    const asOwner = basic(ownerName, owner.key);
    const asForker = basic(forkerName, forker.key);

    const { body: created } = await locks('', asOwner, {
      path: 'asset.bin',
    }).expect(201);
    expect(created.lock).toMatchObject({
      path: 'asset.bin',
      owner: { name: ownerName },
    });
    const { body: conflict } = await locks('', asForker, {
      path: 'asset.bin',
    }).expect(409);
    expect(conflict.lock.id).toBe(created.lock.id);

    const listed = await api()
      .get(`/${ownerName}/${repo}.git/info/lfs/locks`)
      .query({ path: 'asset.bin' })
      .expect(200);
    expect(listed.body).toEqual({ locks: [created.lock], next_cursor: null });

    const ours = await locks('/verify', asOwner, {}).expect(200);
    expect(ours.body).toMatchObject({ ours: [created.lock], theirs: [] });
    const theirs = await locks('/verify', asForker, {}).expect(200);
    expect(theirs.body).toMatchObject({ ours: [], theirs: [created.lock] });

    await locks(`/${created.lock.id}/unlock`, asForker, { force: true }).expect(
      403,
    );
    await locks(`/${created.lock.id}/unlock`, asOwner, {}).expect(200);
    await api()
      .get(`/${ownerName}/${repo}.git/info/lfs/locks`)
      .expect(200, { locks: [], next_cursor: null });
  });
});
