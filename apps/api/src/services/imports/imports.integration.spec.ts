import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import type { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Auth } from '../../lib/auth.js';
import {
  GitHubImportsDisabledError,
  GitHubNotConnectedError,
  ImportNotFailedError,
  ImportNotFoundError,
  ImportRetryWouldOverwriteError,
  RepositoryImportingError,
  StaleImportAttemptError,
} from '../../lib/imports/imports.errors.js';
import { assertNotImporting } from '../../lib/imports/importing.js';
import { ImportsService } from '../../resources/imports/imports.service.js';
import type { RepositoriesService } from '../../resources/repositories/repositories.service.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';
import {
  ImportDispatcherService,
  MAX_IMPORT_ATTEMPTS,
} from './import-dispatcher.service.js';
import { ImportWriterService } from './import-writer.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_import_owner';
const STRANGER = 'user_import_stranger';
const CONFIGURED = new ConfigService({
  IMPORTER_URL: 'http://importer:3004',
  IMPORTER_SECRET: 'secret',
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'client-secret',
});

const issue = {
  number: 3,
  title: 'Crash on start',
  body: 'It crashes',
  authorLogin: 'octocat',
  state: 'closed' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-03T00:00:00.000Z',
  closedAt: '2024-01-02T00:00:00.000Z',
  labels: [{ name: 'bug', color: 'd73a4a', description: null }],
};

const pullRequest = {
  state: 'merged' as const,
  draft: false,
  baseRef: 'main',
  headRef: 'fix',
  headSha: 'b'.repeat(40),
  headInRepository: false,
  mergeCommitSha: 'a'.repeat(40),
  mergedAt: '2024-01-02T00:00:00.000Z',
};

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('GitHub imports', () => {
  let db: Database;
  let pool: Pool;
  let dispatcher: ImportDispatcherService;
  let writer: ImportWriterService;
  let imports: ImportsService;
  let repositoryId: string;
  let importer: ReturnType<typeof vi.fn>;
  let keys = 0;

  const auth = {
    api: {
      createApiKey: vi.fn(async ({ body }: { body: { userId: string } }) => {
        const id = `key_import_${++keys}`;
        await db.insert(schema.apikey).values({
          id,
          referenceId: body.userId,
          key: `hashed-${id}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return { id, key: `ghost_pat_${id}` };
      }),
      getAccessToken: vi.fn(async () => ({ accessToken: 'gh-token' })),
    },
  } as unknown as AuthService<Auth>;

  async function startImport(
    values: Partial<typeof schema.repositoryImport.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(schema.repositoryImport)
      .values({
        repositoryId,
        requestedById: OWNER,
        source: 'octo/repo',
        ...values,
      })
      .returning();
    return row;
  }

  async function importRow() {
    const [row] = await db
      .select()
      .from(schema.repositoryImport)
      .where(eq(schema.repositoryImport.repositoryId, repositoryId));
    return row;
  }

  async function keyExists(id: string | null) {
    if (!id) return false;
    const rows = await db
      .select()
      .from(schema.apikey)
      .where(eq(schema.apikey.id, id));
    return rows.length > 0;
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, STRANGER]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'import-owner@example.com',
        username: 'import_owner',
      },
      {
        id: STRANGER,
        name: 'Stranger',
        email: 'import-stranger@example.com',
        username: 'import_stranger',
      },
    ]);
    await db.insert(schema.account).values({
      id: 'account_import_owner',
      accountId: '1',
      providerId: 'github',
      userId: OWNER,
      updatedAt: new Date(),
    });
    const [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'repo',
        slug: 'repo',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    repositoryId = repository.id;

    importer = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', importer);
    dispatcher = new ImportDispatcherService(db, CONFIGURED, auth);
    writer = new ImportWriterService(db);
    imports = new ImportsService(
      db,
      CONFIGURED,
      auth,
      {
        createRepository: async () => ({ id: repositoryId, slug: 'repo' }),
      } as unknown as RepositoriesService,
      new RepositoryAccessService(db),
      dispatcher,
    );
  });

  afterEach(async () => {
    await dispatcher.onApplicationShutdown();
    vi.unstubAllGlobals();
    await db.delete(schema.apikey).where(eq(schema.apikey.referenceId, OWNER));
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, STRANGER]));
    await pool.end();
  });

  describe('dispatching', () => {
    it('hands a pending import to the importer with a fresh push key', async () => {
      await startImport();
      expect(await dispatcher.tick()).toBe(true);

      const row = await importRow();
      expect(row).toMatchObject({ status: 'running', attempts: 1 });
      expect(await keyExists(row.apiKeyId)).toBe(true);
      const job = JSON.parse(importer.mock.calls[0][1].body);
      expect(job).toEqual({
        importId: row.id,
        attempt: row.claimToken,
        source: 'octo/repo',
        destination: 'import_owner/repo',
        githubToken: 'gh-token',
        ghostToken: `ghost_pat_${row.apiKeyId}`,
      });
    });

    it('puts a refused job back with backoff and drops its key', async () => {
      importer.mockResolvedValue(new Response('busy', { status: 503 }));
      await startImport();
      await dispatcher.tick();

      const row = await importRow();
      expect(row).toMatchObject({
        status: 'pending',
        attempts: 1,
        apiKeyId: null,
        lastError: 'The import could not be started',
      });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
        Date.now() - 1000,
      );
      expect(
        await db
          .select()
          .from(schema.apikey)
          .where(eq(schema.apikey.referenceId, OWNER)),
      ).toEqual([]);
    });

    it('retries an attempt whose importer went silent, with a new token and key', async () => {
      await startImport();
      await dispatcher.tick();
      const first = await importRow();
      await db
        .update(schema.repositoryImport)
        .set({ leaseUntil: sql`now() - interval '1 second'` })
        .where(eq(schema.repositoryImport.id, first.id));

      await dispatcher.tick();
      const second = await importRow();
      expect(second).toMatchObject({
        status: 'running',
        attempts: 2,
        lastError: 'The importer stopped responding',
      });
      expect(second.claimToken).not.toBe(first.claimToken);
      expect(await keyExists(first.apiKeyId)).toBe(false);
      expect(await keyExists(second.apiKeyId)).toBe(true);
      await expect(
        dispatcher.renewLease(first.id, first.claimToken),
      ).rejects.toBeInstanceOf(StaleImportAttemptError);
    });

    it('fails a silent attempt that used the last try', async () => {
      await startImport();
      await dispatcher.tick();
      const row = await importRow();
      await db
        .update(schema.repositoryImport)
        .set({
          attempts: MAX_IMPORT_ATTEMPTS,
          leaseUntil: sql`now() - interval '1 second'`,
        })
        .where(eq(schema.repositoryImport.id, row.id));

      expect(await dispatcher.tick()).toBe(false);
      expect(await importRow()).toMatchObject({
        status: 'failed',
        apiKeyId: null,
        lastError: 'The importer stopped responding',
      });
      expect(await keyExists(row.apiKeyId)).toBe(false);
    });

    it('fails without retrying when the GitHub account is gone', async () => {
      await db.delete(schema.account).where(eq(schema.account.userId, OWNER));
      await startImport();
      await dispatcher.tick();
      expect((await importRow()).status).toBe('failed');
      expect(importer).not.toHaveBeenCalled();
    });

    it('has nothing to do without imports', async () => {
      expect(await dispatcher.tick()).toBe(false);
    });
  });

  describe('callbacks', () => {
    async function running() {
      await startImport();
      await dispatcher.tick();
      return importRow();
    }

    it('renews the lease of the current attempt', async () => {
      const row = await running();
      await db
        .update(schema.repositoryImport)
        .set({ leaseUntil: sql`now()` })
        .where(eq(schema.repositoryImport.id, row.id));
      expect(await dispatcher.renewLease(row.id, row.claimToken)).toBe(
        repositoryId,
      );
      expect((await importRow()).leaseUntil.getTime()).toBeGreaterThan(
        Date.now() + 60_000,
      );
    });

    it('records success, the default branch, and drops the key', async () => {
      const row = await running();
      await dispatcher.settle(row.id, row.claimToken, {
        succeeded: true,
        defaultBranch: 'trunk',
      });
      expect(await importRow()).toMatchObject({
        status: 'succeeded',
        apiKeyId: null,
      });
      expect(await keyExists(row.apiKeyId)).toBe(false);
      const [repository] = await db
        .select()
        .from(schema.repository)
        .where(eq(schema.repository.id, repositoryId));
      expect(repository.defaultBranch).toBe('trunk');
      await expect(
        dispatcher.settle(row.id, row.claimToken, {
          succeeded: true,
          defaultBranch: null,
        }),
      ).rejects.toBeInstanceOf(StaleImportAttemptError);
    });

    it('retries a retryable failure and fails a permanent one', async () => {
      const row = await running();
      await dispatcher.settle(row.id, row.claimToken, {
        succeeded: false,
        error: 'GitHub hiccup',
        retryable: true,
      });
      expect(await importRow()).toMatchObject({
        status: 'pending',
        lastError: 'GitHub hiccup',
      });

      await db
        .update(schema.repositoryImport)
        .set({ nextAttemptAt: sql`now()` })
        .where(eq(schema.repositoryImport.id, row.id));
      await dispatcher.tick();
      const next = await importRow();
      await dispatcher.settle(next.id, next.claimToken, {
        succeeded: false,
        error: 'Repository not found',
        retryable: false,
      });
      expect(await importRow()).toMatchObject({
        status: 'failed',
        lastError: 'Repository not found',
      });
    });

    it('fails a retryable failure once attempts run out', async () => {
      const row = await running();
      await db
        .update(schema.repositoryImport)
        .set({ attempts: MAX_IMPORT_ATTEMPTS })
        .where(eq(schema.repositoryImport.id, row.id));
      await dispatcher.settle(row.id, row.claimToken, {
        succeeded: false,
        error: 'Still broken',
        retryable: true,
      });
      expect((await importRow()).status).toBe('failed');
    });
  });

  describe('writing', () => {
    it('upserts releases by tag', async () => {
      const release = {
        tagName: 'v1',
        name: 'One',
        body: null,
        isDraft: false,
        isPrerelease: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        publishedAt: '2024-01-01T00:00:00.000Z',
      };
      await writer.writeReleases(repositoryId, [release]);
      await writer.writeReleases(repositoryId, [
        { ...release, name: 'One, again' },
      ]);
      await writer.writeReleases(repositoryId, []);

      const rows = await db
        .select()
        .from(schema.release)
        .where(eq(schema.release.repositoryId, repositoryId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'One, again',
        authorId: schema.IMPORTER_USER_ID,
      });
    });

    it('keeps numbers, credits authors and attaches pull requests', async () => {
      await writer.writeIssues(repositoryId, [
        issue,
        { ...issue, number: 5, labels: [], state: 'closed', pullRequest },
        {
          ...issue,
          number: 6,
          state: 'open',
          closedAt: null,
          labels: [],
          pullRequest: {
            ...pullRequest,
            state: 'open',
            mergeCommitSha: null,
            mergedAt: null,
          },
        },
      ]);

      const rows = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.repositoryId, repositoryId))
        .orderBy(schema.issue.number);
      expect(
        rows.map((row) => [row.number, row.state, row.isPullRequest]),
      ).toEqual([
        [3, 'closed', false],
        [5, 'closed', true],
        [6, 'closed', true],
      ]);
      expect(rows[0].body).toBe(
        '_Opened by [@octocat](https://github.com/octocat) on GitHub._\n\nIt crashes',
      );
      expect(rows[0].createdAt.toISOString()).toBe(issue.createdAt);
      expect(rows[2].body).toContain('came from a fork');

      const pulls = await db
        .select()
        .from(schema.pullRequest)
        .where(inArray(schema.pullRequest.issueId, [rows[1].id, rows[2].id]));
      expect(pulls.find((pull) => pull.issueId === rows[1].id)).toMatchObject({
        state: 'merged',
        mergeCommitSha: 'a'.repeat(40),
        headRepositoryId: null,
      });
      expect(pulls.find((pull) => pull.issueId === rows[2].id)?.state).toBe(
        'closed',
      );

      const labels = await db
        .select({ name: schema.label.name })
        .from(schema.issueLabel)
        .innerJoin(schema.label, eq(schema.label.id, schema.issueLabel.labelId))
        .where(eq(schema.issueLabel.issueId, rows[0].id));
      expect(labels).toEqual([{ name: 'bug' }]);
    });

    it('keeps a same-repository head live', async () => {
      await writer.writeIssues(repositoryId, [
        {
          ...issue,
          state: 'open',
          closedAt: null,
          labels: [],
          pullRequest: {
            ...pullRequest,
            state: 'open',
            headInRepository: true,
            mergeCommitSha: null,
            mergedAt: null,
          },
        },
      ]);
      const [pull] = await db
        .select({
          state: schema.pullRequest.state,
          headRepositoryId: schema.pullRequest.headRepositoryId,
        })
        .from(schema.pullRequest)
        .innerJoin(
          schema.issue,
          eq(schema.issue.id, schema.pullRequest.issueId),
        )
        .where(eq(schema.issue.repositoryId, repositoryId));
      expect(pull).toEqual({ state: 'open', headRepositoryId: repositoryId });
    });

    it('deduplicates comment batches and starts over when the issue is sent again', async () => {
      await writer.writeIssues(repositoryId, [issue]);
      const comment = {
        githubId: 4_000_000_000,
        issueNumber: 3,
        authorLogin: 'hubot',
        body: 'Same here',
        createdAt: '2024-01-01T01:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
      };
      await writer.writeComments(repositoryId, [
        comment,
        comment,
        { ...comment, githubId: comment.githubId + 1 },
        { ...comment, issueNumber: 99 },
      ]);
      await writer.writeComments(repositoryId, [comment]);
      await writer.writeComments(repositoryId, []);

      const read = async () => {
        const [row] = await db
          .select()
          .from(schema.issue)
          .where(
            and(
              eq(schema.issue.repositoryId, repositoryId),
              eq(schema.issue.number, 3),
            ),
          );
        const comments = await db
          .select()
          .from(schema.issueComment)
          .where(eq(schema.issueComment.issueId, row.id));
        return { row, comments };
      };

      const before = await read();
      expect(before.comments).toHaveLength(2);
      expect(before.comments.map((row) => row.githubId).sort()).toEqual([
        comment.githubId,
        comment.githubId + 1,
      ]);
      expect(before.row.commentCount).toBe(2);
      expect(before.row.updatedAt.toISOString()).toBe(issue.updatedAt);
      expect(before.comments[0].body).toBe(
        '_Posted by [@hubot](https://github.com/hubot) on GitHub._\n\nSame here',
      );

      await writer.writeIssues(repositoryId, [issue]);
      const after = await read();
      expect(after.row.commentCount).toBe(0);
      expect(after.comments).toEqual([]);

      await writer.writeComments(repositoryId, [
        { ...comment, issueNumber: 99 },
      ]);
      expect((await read()).comments).toEqual([]);
    });

    it('writes nothing for an empty batch', async () => {
      await writer.writeIssues(repositoryId, []);
      expect(
        await db
          .select()
          .from(schema.issue)
          .where(eq(schema.issue.repositoryId, repositoryId)),
      ).toEqual([]);
    });
  });

  describe('the import flow', () => {
    const owner = {
      username: 'import_owner',
      repo: 'repo',
      requesterId: OWNER,
    };

    it('reports availability and the linked account', async () => {
      expect(await imports.githubStatus(OWNER)).toEqual({
        enabled: true,
        connected: true,
      });
      expect(await imports.githubStatus(STRANGER)).toEqual({
        enabled: true,
        connected: false,
      });
    });

    it('lists repositories with the linked account only', async () => {
      importer.mockResolvedValueOnce(
        Response.json([
          { full_name: 'octo/repo', private: false, description: 'A repo' },
        ]),
      );
      expect(await imports.githubRepositories(OWNER)).toEqual({
        repositories: [
          { fullName: 'octo/repo', private: false, description: 'A repo' },
        ],
      });
      await expect(imports.githubRepositories(STRANGER)).rejects.toBeInstanceOf(
        GitHubNotConnectedError,
      );
    });

    it('starts an import for a readable repository', async () => {
      importer.mockResolvedValueOnce(Response.json({ full_name: 'octo/repo' }));
      await imports.start({ source: 'octo/repo', name: 'repo' }, OWNER);
      expect(importer.mock.calls[0][0]).toBe(
        'https://api.github.com/repos/octo/repo',
      );
      expect((await importRow()).source).toBe('octo/repo');
      await expect(assertNotImporting(db, repositoryId)).rejects.toBeInstanceOf(
        RepositoryImportingError,
      );
    });

    it('refuses to start without configuration or a linked account', async () => {
      const disabled = new ImportsService(
        db,
        new ConfigService({}),
        auth,
        {} as RepositoriesService,
        new RepositoryAccessService(db),
        dispatcher,
      );
      await expect(
        disabled.start({ source: 'octo/repo', name: 'repo' }, OWNER),
      ).rejects.toBeInstanceOf(GitHubImportsDisabledError);
      await expect(
        imports.start({ source: 'octo/repo', name: 'repo' }, STRANGER),
      ).rejects.toBeInstanceOf(GitHubNotConnectedError);
    });

    it('shows progress and retries a failed import', async () => {
      await expect(imports.status(owner)).rejects.toBeInstanceOf(
        ImportNotFoundError,
      );
      await expect(imports.retry(owner)).rejects.toBeInstanceOf(
        ImportNotFoundError,
      );

      await startImport({
        status: 'failed',
        attempts: MAX_IMPORT_ATTEMPTS,
        lastError: 'boom',
      });
      expect(
        await imports.status({ ...owner, requesterId: undefined }),
      ).toMatchObject({
        status: 'failed',
        lastError: 'boom',
        source: 'octo/repo',
      });
      await assertNotImporting(db, repositoryId);

      await writer.writeIssues(repositoryId, [issue]);
      await imports.retry(owner);
      expect(await importRow()).toMatchObject({ attempts: 0, lastError: null });
      await expect(imports.retry(owner)).rejects.toBeInstanceOf(
        ImportNotFailedError,
      );
    });

    it('refuses a retry after a local issue was created', async () => {
      await startImport({ status: 'failed', attempts: 6, lastError: 'boom' });
      await db.insert(schema.issue).values({
        repositoryId,
        number: 1,
        title: 'Local issue',
        authorId: OWNER,
      });
      const wake = vi.spyOn(dispatcher, 'wake');
      await expect(imports.retry(owner)).rejects.toBeInstanceOf(
        ImportRetryWouldOverwriteError,
      );
      expect(await importRow()).toMatchObject({
        status: 'failed',
        attempts: 6,
        lastError: 'boom',
      });
      expect(wake).not.toHaveBeenCalled();
    });

    it('makes an issue being opened wait for a retry holding the import row, then refuses it', async () => {
      await startImport({ status: 'failed' });
      const retrying = await pool.connect();
      try {
        await retrying.query('begin');
        await retrying.query(
          'select 1 from repository_import where repository_id = $1 for update',
          [repositoryId],
        );

        let settled = false;
        const opening = db
          .transaction((tx) => assertNotImporting(tx, repositoryId))
          .finally(() => {
            settled = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settled).toBe(false);

        await retrying.query(
          `update repository_import set status = 'pending' where repository_id = $1`,
          [repositoryId],
        );
        await retrying.query('commit');
        await expect(opening).rejects.toBeInstanceOf(RepositoryImportingError);
      } finally {
        retrying.release();
      }
    });

    it('retries only for a caller with GitHub linked', async () => {
      await startImport({ status: 'failed' });
      await db.delete(schema.account).where(eq(schema.account.userId, OWNER));
      await expect(imports.retry(owner)).rejects.toBeInstanceOf(
        GitHubNotConnectedError,
      );
    });
  });
});
