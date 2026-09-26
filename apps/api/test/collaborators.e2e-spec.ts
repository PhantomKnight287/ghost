import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { DATABASE_URL, hasBackends, signUp, startApp } from './harness.js';

type Account = { cookie: string; key: string };

describe.skipIf(!hasBackends)('collaborators', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let alice: Account;
  let mallory: Account;
  let work: string;
  const stamp = Date.now();
  const ownerName = `owner${stamp}`;
  const aliceName = `alice${stamp}`;
  const malloryName = `mallory${stamp}`;
  let repo: string;

  const api = () => request(app.getHttpServer());
  const at = (suffix = '') => `/api/repositories/${ownerName}/${repo}${suffix}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (username: string, account: Account) =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${account.key}@`)}/${ownerName}/${repo}.git`,
        'HEAD:refs/heads/main',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const invite = (username: string, role: string, as = owner) =>
    api()
      .put(at(`/collaborators/${username}`))
      .set('cookie', as.cookie)
      .send({ role });
  const pendingInvitation = async (account: Account) =>
    (
      await api()
        .get('/api/invitations')
        .set('cookie', account.cookie)
        .expect(200)
    ).body.invitations[0];

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    alice = await signUp(app, aliceName);
    mallory = await signUp(app, malloryName);

    repo = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'secret', visibility: 'private' })
        .expect(201)
    ).body.slug;
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-collaborators-'));
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'first');
    await push(ownerName, owner);
    await api()
      .post(at('/issues'))
      .set('cookie', owner.cookie)
      .send({ title: 'Owner issue' })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('refuses to invite the owner or someone who does not exist', async () => {
    await invite(ownerName, 'write').expect(400);
    await invite(`nobody${stamp}`, 'write').expect(404);
  });

  it('grants nothing until the invitation is accepted', async () => {
    const { body } = await invite(aliceName, 'read').expect(200);
    expect(body).toMatchObject({
      username: aliceName,
      role: 'read',
      status: 'pending',
    });

    await api().get(at()).set('cookie', alice.cookie).expect(404);
    expect(await pendingInvitation(alice)).toMatchObject({
      repository: { username: ownerName, slug: repo },
      role: 'read',
      invitedByUsername: ownerName,
    });
  });

  it('keeps invitations to themselves', async () => {
    const invitation = await pendingInvitation(alice);
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', mallory.cookie)
      .expect(404);
    await api()
      .get(at('/collaborators'))
      .set('cookie', mallory.cookie)
      .expect(404);
  });

  it('lets a reader read and nothing more', async () => {
    const invitation = await pendingInvitation(alice);
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', alice.cookie)
      .expect(204);

    const { body } = await api()
      .get(at())
      .set('cookie', alice.cookie)
      .expect(200);
    expect(body.viewerRole).toBe('read');
    const listed = await api()
      .get(`/api/repositories/${ownerName}`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(
      listed.body.repositories.map((r: { slug: string }) => r.slug),
    ).toContain(repo);
    const mine = await api()
      .get('/api/repositories')
      .set('cookie', alice.cookie)
      .expect(200);
    expect(mine.body.repositories).toEqual([
      expect.objectContaining({
        owner: ownerName,
        slug: repo,
        visibility: 'private',
        viewerRole: 'read',
      }),
    ]);

    git('commit', '-q', '--allow-empty', '-m', 'from alice');
    await expect(push(aliceName, alice)).rejects.toThrow();
    await api()
      .post(at('/issues/1/close'))
      .set('cookie', alice.cookie)
      .expect(403);
    await invite(malloryName, 'read', alice).expect(403);
  });

  it('lets triage close issues but not edit them', async () => {
    await invite(aliceName, 'triage').expect(200);

    await api()
      .patch(at('/issues/1'))
      .set('cookie', alice.cookie)
      .send({ title: 'Renamed by alice' })
      .expect(403);
    await api()
      .post(at('/issues/1/close'))
      .set('cookie', alice.cookie)
      .expect(201);
  });

  it('lets write push', async () => {
    await invite(aliceName, 'write').expect(200);
    await push(aliceName, alice);
  });

  it('lets maintain change settings, but not visibility', async () => {
    await invite(aliceName, 'maintain').expect(200);

    await api()
      .patch(at())
      .set('cookie', alice.cookie)
      .send({ description: 'maintained' })
      .expect(200);
    await api()
      .patch(at())
      .set('cookie', alice.cookie)
      .send({ visibility: 'public' })
      .expect(403);
    await api()
      .get(at('/collaborators'))
      .set('cookie', alice.cookie)
      .expect(403);
  });

  it('lets admin manage collaborators', async () => {
    await invite(aliceName, 'admin').expect(200);

    await invite(malloryName, 'read', alice).expect(200);
    const { body } = await api()
      .get(at('/collaborators'))
      .set('cookie', alice.cookie)
      .expect(200);
    expect(
      body.collaborators.map((c: { username: string; status: string }) => [
        c.username,
        c.status,
      ]),
    ).toEqual([
      [aliceName, 'accepted'],
      [malloryName, 'pending'],
    ]);
  });

  it('lets an invitation lapse after a week, and sends it again on a new invite', async () => {
    const invitation = await pendingInvitation(mallory);
    const { db, pool } = createDatabase({ connectionString: DATABASE_URL });
    await db
      .update(schema.repositoryCollaborator)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.repositoryCollaborator.id, invitation.id));
    await pool.end();

    expect(await pendingInvitation(mallory)).toBeUndefined();
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', mallory.cookie)
      .expect(404);
    const { body } = await api()
      .get(at('/collaborators'))
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body.collaborators).toContainEqual(
      expect.objectContaining({ username: malloryName, status: 'expired' }),
    );

    await invite(malloryName, 'triage').expect(200);
    expect(await pendingInvitation(mallory)).toMatchObject({
      id: invitation.id,
      role: 'triage',
    });
  });

  it('lets an invitee decline', async () => {
    const invitation = await pendingInvitation(mallory);
    await api()
      .delete(`/api/invitations/${invitation.id}`)
      .set('cookie', mallory.cookie)
      .expect(204);
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', mallory.cookie)
      .expect(404);
  });

  it('lets a collaborator leave', async () => {
    await api()
      .delete(at(`/collaborators/${aliceName}`))
      .set('cookie', alice.cookie)
      .expect(204);
    await api().get(at()).set('cookie', alice.cookie).expect(404);
  });
});
