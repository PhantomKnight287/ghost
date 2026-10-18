import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

describe.skipIf(!hasBackends)('CODEOWNERS', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let writer: Account;
  let reader: Account;
  let work: string;
  const stamp = Date.now();
  const ownerName = `coowner${stamp}`;
  const writerName = `cowriter${stamp}`;
  const readerName = `coreader${stamp}`;
  const org = `coorg${stamp}`;

  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const db = () => app.get<Database>(DATABASE);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (to: string, branch = 'main') =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        '-f',
        `${origin.replace('://', `://${ownerName}:${owner.key}@`)}/${to}.git`,
        `HEAD:${branch}`,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const commit = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'files');
  };
  const collaborate = async (
    account: Account,
    username: string,
    role: string,
  ) => {
    await api()
      .put(`/api/repositories/${org}/widget/collaborators/${username}`)
      .set('cookie', owner.cookie)
      .send({ role })
      .expect(200);
    const invitation = (
      await api()
        .get('/api/invitations')
        .set('cookie', account.cookie)
        .expect(200)
    ).body.invitations[0];
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', account.cookie)
      .expect(204);
  };

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    writer = await signUp(app, writerName);
    reader = await signUp(app, readerName);
    await db()
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, writer.userId));
    await db()
      .insert(schema.userEmail)
      .values({
        id: randomUUID(),
        userId: writer.userId,
        email: `${writerName}-alt@example.com`,
        verified: false,
      });

    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'Codeowners Org', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    }))!;
    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'widget', organization: org, visibility: 'private' })
      .expect(201);
    await collaborate(writer, writerName, 'write');
    await collaborate(reader, readerName, 'read');
    for (const [name, role] of [
      ['Core', 'write'],
      ['Readers', 'read'],
    ]) {
      const team = await auth().createTeam({
        body: { name, organizationId },
        headers: new Headers({ cookie: owner.cookie }),
      });
      await api()
        .put(`/api/repositories/${org}/widget/teams/${team!.id}`)
        .set('cookie', owner.cookie)
        .send({ role })
        .expect(204);
    }

    await api()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'plain', visibility: 'public' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-codeowners-'));
    git('init', '-q', '-b', 'main');
    commit({ 'README.md': 'hi\n' });
    await push(`${ownerName}/plain`);
    commit({
      '.github/CODEOWNERS': `* @${writerName}\n`,
      '.ghost/CODEOWNERS': [
        '# Owners',
        `* @${ownerName}`,
        `*.md ${writerName}@example.com ${writerName}-alt@example.com`,
        `docs/ @alcie @${readerName} @${writerName}`,
        `src/ @${org}/core @${org}/readers @${org}/nope @elsewhere/core`,
        'vendor/',
        '[ab].txt @x',
        '',
      ].join('\n'),
    });
    await push(`${org}/widget`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('reports the active file and its syntax and owner errors in line order', async () => {
    const { body } = await api()
      .get(`/api/repositories/${org}/widget/codeowners`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body.path).toBe('.ghost/CODEOWNERS');
    expect(
      body.errors.map((error: { line: number; kind: string }) => [
        error.line,
        error.kind,
      ]),
    ).toEqual([
      [3, 'Unknown owner'],
      [4, 'Unknown owner'],
      [4, 'Owner without write access'],
      [5, 'Team without write access'],
      [5, 'Unknown team'],
      [5, 'Unknown team'],
      [7, 'Invalid pattern'],
    ]);
    expect(body.errors[1]).toEqual({
      line: 4,
      column: 7,
      kind: 'Unknown owner',
      source: `docs/ @alcie @${readerName} @${writerName}`,
      suggestion: null,
      message:
        'Unknown owner on line 4: make sure @alcie exists and has write access to the repository',
      path: '.ghost/CODEOWNERS',
    });
  });

  it('names the owners of each path from the active file only, with write access and verified emails', async () => {
    const { body } = await api()
      .get(`/api/repositories/${org}/widget/codeowners/owners`)
      .query(
        'path=README.md&path=docs/guide.txt&path=src/main.ts&path=vendor/x.c&path=other.txt',
      )
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body.owners).toEqual({
      'README.md': [`@${writerName}`],
      'docs/guide.txt': [`@${writerName}`],
      'src/main.ts': [`@${org}/core`],
      'vendor/x.c': [],
      'other.txt': [`@${ownerName}`],
    });
  });

  it('refuses a path that is not repository-relative', async () => {
    await api()
      .get(`/api/repositories/${org}/widget/codeowners/owners`)
      .query('path=../x')
      .set('cookie', owner.cookie)
      .expect(400);
  });

  it('needs read access to the repository', async () => {
    await api().get(`/api/repositories/${org}/widget/codeowners`).expect(401);
    await api()
      .get(`/api/v3/repos/${org}/widget/codeowners/errors`)
      .expect(404);
  });

  it('answers the GitHub errors route, and 404 without a file', async () => {
    const { body } = await api()
      .get(`/api/v3/repos/${org}/widget/codeowners/errors`)
      .set('authorization', `token ${owner.key}`)
      .expect(200);
    expect(body.errors).toHaveLength(7);
    expect(body.errors[1].message).toBe(
      'Unknown owner on line 4: make sure @alcie exists and has write access to the repository',
    );

    await api()
      .get(`/api/v3/repos/${ownerName}/plain/codeowners/errors`)
      .set('authorization', `token ${owner.key}`)
      .expect(404);
    const { body: none } = await api()
      .get(`/api/repositories/${ownerName}/plain/codeowners`)
      .expect(200);
    expect(none).toEqual({ path: null, errors: [] });
  });

  it('reads the file at the requested ref, where a user repository has no teams', async () => {
    await push(`${ownerName}/plain`, 'owned');
    const { body } = await api()
      .get(`/api/repositories/${ownerName}/plain/codeowners`)
      .query({ ref: 'owned' })
      .expect(200);
    expect(body.path).toBe('.ghost/CODEOWNERS');
    const atRef = await api()
      .get(`/api/repositories/${ownerName}/plain/codeowners/owners`)
      .query({ ref: 'owned', path: 'src/a.ts' })
      .expect(200);
    expect(atRef.body.owners).toEqual({ 'src/a.ts': [] });
    expect(
      body.errors.filter(
        (error: { kind: string }) => error.kind === 'Unknown team',
      ),
    ).toHaveLength(4);
  });
});
