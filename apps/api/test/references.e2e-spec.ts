import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createDatabase } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../src/lib/auth.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT;
const SOURCE = 'https://github.com/phantomknight287/portfolio';
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../packages/db/drizzle',
);
// Cloned once per machine; the suite only ever reads it.
const CLONE = path.join(tmpdir(), 'ghost-e2e-portfolio.git');

type TimelineItem = {
  kind: 'comment' | 'event' | 'reference';
  event?: {
    type: string;
    sourceNumber: number | null;
    commitSha: string | null;
  };
  source?: { number: number; isPullRequest: boolean } | null;
  sourceType?: string;
  commitSha?: string | null;
};

// Needs a throwaway Postgres, an S3 endpoint (RustFS from compose.yaml works) and network access to GitHub; skipped without the first two.
describe.skipIf(!DATABASE_URL || !S3_ENDPOINT)(
  'issue and pull request references against a real repository',
  () => {
    let app: INestApplication;
    let origin: string;
    let cookie: string;
    let work: string;
    const username = `refs${Date.now()}`;
    let repo: string;

    const api = () => request(app.getHttpServer());
    const at = (suffix: string) =>
      `/api/repositories/${username}/${repo}${suffix}`;
    const gitEnv = () => ({
      ...process.env,
      GIT_AUTHOR_NAME: 'E2E',
      GIT_AUTHOR_EMAIL: `${username}@example.com`,
      GIT_COMMITTER_NAME: 'E2E',
      GIT_COMMITTER_EMAIL: `${username}@example.com`,
      GIT_TERMINAL_PROMPT: '0',
    });
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: work,
        encoding: 'utf8',
        env: gitEnv(),
      }).trim();
    // The server runs in this process, so anything that talks to it must not block the event loop.
    const remote = (...args: string[]) =>
      promisify(execFile)('git', args, { cwd: work, env: gitEnv() });
    const commit = (message: string) =>
      git('commit', '--allow-empty', '-q', '-m', message);

    const issue = (number: number) =>
      api()
        .get(at(`/issues/${number}`))
        .set('cookie', cookie)
        .expect(200)
        .then((response) => response.body);
    const timeline = (number: number) =>
      api()
        .get(at(`/issues/${number}/timeline`))
        .set('cookie', cookie)
        .expect(200)
        .then((response) => response.body.timeline as TimelineItem[]);
    const openIssue = (title: string, body?: string) =>
      api()
        .post(at('/issues'))
        .set('cookie', cookie)
        .send({ title, body })
        .expect(201)
        .then((response) => response.body.number as number);

    beforeAll(async () => {
      Object.assign(process.env, {
        DATABASE_URL,
        S3_ENDPOINT,
        S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? 'ghost',
        S3_SECRET_ACCESS_KEY:
          process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'ghostsecret',
        S3_BUCKET: process.env.TEST_S3_BUCKET ?? 'ghost-e2e',
        BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
        BETTER_AUTH_URL: 'http://127.0.0.1',
        EMAIL_VERIFICATION_ENABLED: 'false',
        ZOEKT_URL: '',
        GIT_SSH_HOST_KEY: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        PYROSCOPE_SERVER_ADDRESS: '',
      });

      const { db, pool } = createDatabase({ connectionString: DATABASE_URL });
      await migrate(db, { migrationsFolder: MIGRATIONS });
      await pool.end();

      await new S3Client({
        endpoint: S3_ENDPOINT,
        region: 'auto',
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        },
      })
        .send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }))
        .catch((error: unknown) => {
          if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
        });

      // Imported late so the module reads the environment set above.
      const { AppModule } = await import('../src/app.module.js');
      const { configureApp } = await import('../src/app.setup.js');
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication({ bodyParser: false });
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

      const auth = app.get<AuthService<Auth>>(AuthService).api;
      const email = `${username}@example.com`;
      const password = 'correct horse battery staple';
      const { user } = await auth.signUpEmail({
        body: { email, password, name: 'E2E', username },
      });
      const { headers } = await auth.signInEmail({
        body: { email, password },
        returnHeaders: true,
      });
      cookie = headers.get('set-cookie') ?? '';
      const { key } = await auth.createApiKey({ body: { userId: user.id } });

      const created = await api()
        .post('/api/repositories')
        .set('cookie', cookie)
        .send({ name: 'portfolio', visibility: 'public' })
        .expect(201);
      repo = created.body.slug;

      if (!existsSync(CLONE)) {
        execFileSync('git', ['clone', '-q', '--mirror', SOURCE, CLONE]);
      }
      work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-work-'));
      execFileSync('git', ['clone', '-q', CLONE, work]);
      git(
        'remote',
        'add',
        'ghost',
        `${origin.replace('://', `://${username}:${key}@`)}/${username}/${repo}.git`,
      );
      await remote('push', '-q', 'ghost', 'HEAD:refs/heads/main');
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (work) rmSync(work, { recursive: true, force: true });
    });

    it('numbers issues and pull requests from one sequence, and keeps pull requests out of the issue list', async () => {
      expect(await openIssue('Navbar overlaps on mobile')).toBe(1);
      expect(await openIssue('Dark mode flickers')).toBe(2);
      expect(await openIssue('Footer links 404')).toBe(3);

      git('checkout', '-q', '-b', 'fix-navbar');
      commit('Tidy navbar spacing\n\nFixes #2');
      await remote('push', '-q', 'ghost', 'fix-navbar');
      // not the default branch, so nothing closes yet
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await issue(2)).state).toBe('open');

      const pull = await api()
        .post(at('/pulls'))
        .set('cookie', cookie)
        .send({
          title: 'Fix the navbar',
          body: 'Closes #1. Related to #3.\n\n`#2` in code is not a reference.',
          base: 'main',
          head: 'fix-navbar',
        })
        .expect(201);
      expect(pull.body.number).toBe(4);

      expect(await issue(4)).toMatchObject({ isPullRequest: true });
      const listed = await api()
        .get(at('/issues?state=all'))
        .set('cookie', cookie)
        .expect(200);
      expect(
        listed.body.issues.map((row: { number: number }) => row.number),
      ).toEqual([3, 2, 1]);
    });

    it('shows where an issue was mentioned', async () => {
      await api()
        .post(at('/issues/3/comments'))
        .set('cookie', cookie)
        .send({ body: 'Probably the same root cause as #1' })
        .expect(201);

      expect(await timeline(3)).toContainEqual(
        expect.objectContaining({
          kind: 'reference',
          sourceType: 'issue',
          source: expect.objectContaining({ number: 4, isPullRequest: true }),
        }),
      );
      expect(await timeline(1)).toContainEqual(
        expect.objectContaining({
          kind: 'reference',
          source: expect.objectContaining({ number: 3, isPullRequest: false }),
        }),
      );
      // inside backticks, so the pull request never mentioned #2
      expect(
        (await timeline(2)).filter((item) => item.kind === 'reference'),
      ).toEqual([]);
    });

    it('closes what the pull request and its commits promise when it merges into the default branch', async () => {
      await api()
        .post(at('/pulls/4/merge'))
        .set('cookie', cookie)
        .send({})
        .expect(201);

      const pull = await api().get(at('/pulls/4')).set('cookie', cookie);
      expect(pull.body.state).toBe('merged');
      expect(
        (await timeline(4)).some((item) => item.event?.type === 'merged'),
      ).toBe(true);

      for (const number of [1, 2]) {
        expect(await issue(number)).toMatchObject({ state: 'closed' });
        expect(await timeline(number)).toContainEqual(
          expect.objectContaining({
            kind: 'event',
            event: expect.objectContaining({ type: 'closed', sourceNumber: 4 }),
          }),
        );
      }
      // "Related to" is a mention, not a promise
      expect((await issue(3)).state).toBe('open');
    });

    it('closes an issue from a commit pushed straight to the default branch', async () => {
      git('checkout', '-q', 'main');
      await remote('pull', '-q', '--no-rebase', 'ghost', 'main');
      commit('Repair footer links (resolves #3)');
      const sha = git('rev-parse', 'HEAD');
      await remote('push', '-q', 'ghost', 'main');

      await vi.waitFor(
        async () => expect((await issue(3)).state).toBe('closed'),
        { timeout: 15_000, interval: 250 },
      );
      expect(await timeline(3)).toContainEqual(
        expect.objectContaining({
          kind: 'event',
          event: expect.objectContaining({ type: 'closed', commitSha: sha }),
        }),
      );
      expect(await timeline(3)).toContainEqual(
        expect.objectContaining({
          kind: 'reference',
          sourceType: 'commit',
          commitSha: sha,
        }),
      );
    });
  },
);
