import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

/** A fresh public key line: a fingerprint belongs to one account per table, so each test adds its own. */
function freshKey() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ghost-sshsig-'));
  try {
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      'laptop',
      '-f',
      path.join(dir, 'id'),
    ]);
    return readFileSync(path.join(dir, 'id.pub'), 'utf8').trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hasBackends)('SSH signing keys', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, `sshsig${Date.now()}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('adds, lists and removes a signing key through the Ghost API', async () => {
    const line = freshKey();
    const added = await api()
      .post('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: line, title: 'signing laptop' })
      .expect(201);
    expect(added.body).toMatchObject({
      title: 'signing laptop',
      type: 'ssh-ed25519',
      publicKey: line.split(' ').slice(0, 2).join(' '),
      fingerprint: expect.any(String),
    });

    const listed = await api()
      .get('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .expect(200);
    expect(listed.body.keys.map((key: { id: string }) => key.id)).toContain(
      added.body.id,
    );

    await api()
      .delete(`/api/ssh-signing-keys/${added.body.id}`)
      .set('cookie', owner.cookie)
      .expect(204);
    await api()
      .delete(`/api/ssh-signing-keys/${added.body.id}`)
      .set('cookie', owner.cookie)
      .expect(404);
  });

  it('refuses something that is not a public key', async () => {
    await api()
      .post('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: 'not a key' })
      .expect(400);
  });

  it('lets one key be both an authentication key and a signing key, granting no git access as a signing key', async () => {
    const line = freshKey();
    await api()
      .post('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: line })
      .expect(201);
    const authKeys = await api()
      .get('/api/ssh-keys')
      .set('cookie', owner.cookie)
      .expect(200);
    expect(
      authKeys.body.keys.map((key: { publicKey: string }) => key.publicKey),
    ).not.toContain(line.split(' ').slice(0, 2).join(' '));

    await api()
      .post('/api/ssh-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: line })
      .expect(201);
  });

  it('refuses the same signing key twice', async () => {
    const line = freshKey();
    await api()
      .post('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: line })
      .expect(201);
    await api()
      .post('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: line })
      .expect(409);
  });

  describe('GitHub REST', () => {
    const v3 = (
      method: 'get' | 'post' | 'delete',
      route: string,
      key: string,
    ) => api()[method](`/api/v3${route}`).set('authorization', `token ${key}`);

    it('adds, lists, reads and deletes a signing key in GitHub shape', async () => {
      const line = freshKey();
      const added = await v3('post', '/user/ssh_signing_keys', owner.key)
        .send({ key: line, title: 'gh signing' })
        .expect(201);
      expect(added.body).toEqual({
        id: expect.any(Number),
        key: line.split(' ').slice(0, 2).join(' '),
        title: 'gh signing',
        created_at: expect.any(String),
      });

      const listed = await v3(
        'get',
        '/user/ssh_signing_keys',
        owner.key,
      ).expect(200);
      expect(listed.body).toContainEqual(added.body);

      const one = await v3(
        'get',
        `/user/ssh_signing_keys/${added.body.id}`,
        owner.key,
      ).expect(200);
      expect(one.body).toEqual(added.body);

      await v3(
        'delete',
        `/user/ssh_signing_keys/${added.body.id}`,
        owner.key,
      ).expect(204);
      await v3(
        'get',
        `/user/ssh_signing_keys/${added.body.id}`,
        owner.key,
      ).expect(404);
    });

    it('answers a duplicate key with 422, as GitHub does', async () => {
      const line = freshKey();
      await v3('post', '/user/ssh_signing_keys', owner.key)
        .send({ key: line, title: 'first' })
        .expect(201);
      await v3('post', '/user/ssh_signing_keys', owner.key)
        .send({ key: line, title: 'again' })
        .expect(422);
    });

    it('needs the ssh_signing_key scopes', async () => {
      const readOnly = await scopedKey(app, owner.userId, [
        'read:ssh_signing_key',
      ]);
      await v3('get', '/user/ssh_signing_keys', readOnly).expect(200);
      await v3('post', '/user/ssh_signing_keys', readOnly)
        .send({ key: freshKey(), title: 'nope' })
        .expect(403);

      const publicKeyOnly = await scopedKey(app, owner.userId, [
        'admin:public_key',
      ]);
      await v3('get', '/user/ssh_signing_keys', publicKeyOnly).expect(403);

      const admin = await scopedKey(app, owner.userId, [
        'admin:ssh_signing_key',
      ]);
      await v3('post', '/user/ssh_signing_keys', admin)
        .send({ key: freshKey(), title: 'admin scope' })
        .expect(201);
    });

    it("does not show another account's key by id", async () => {
      const added = await v3('post', '/user/ssh_signing_keys', owner.key)
        .send({ key: freshKey(), title: 'mine' })
        .expect(201);
      const other = await signUp(app, `sshsigother${Date.now()}`);
      await v3(
        'get',
        `/user/ssh_signing_keys/${added.body.id}`,
        other.key,
      ).expect(404);
      await v3(
        'delete',
        `/user/ssh_signing_keys/${added.body.id}`,
        other.key,
      ).expect(404);
    });
  });
});
