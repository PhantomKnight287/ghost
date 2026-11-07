import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { and, eq, inArray, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { InvalidStatusShaError } from '../../lib/commit-statuses/commit-statuses.errors.js';
import { RepositoryForbiddenError } from '../../lib/repositories/access/repository-access.errors.js';
import {
  CheckAppGoneError,
  ChecksNeedInstallationError,
  NotRunOwnerError,
  TooManyAnnotationsError,
  UnknownCheckActionError,
} from '../../lib/checks/checks.errors.js';
import { InMemoryWalStore } from '../../lib/git/materializer/wal-store.fake.js';
import { bufferBody } from '../../lib/git/protocol/git-request-body.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { CommitHolderService } from '../../services/git/commit-holder/commit-holder.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import type { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CommitStatusesService } from '../commit-statuses/commit-statuses.service.js';
import { ChecksService } from './checks.service.js';
import { CommitChecksService } from './commit-checks.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_checks_owner';
const CI_BOT = 'user_checks_ci_bot';
const OTHER_BOT = 'user_checks_other_bot';
const READER = 'user_checks_reader';

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('checks', () => {
  let db: Database;
  let pool: Pool;
  let root: string;
  let checks: ChecksService;
  let statuses: CommitStatusesService;
  let commitChecks: CommitChecksService;
  let ciAppNumericId: number;
  let repository: typeof schema.repository.$inferSelect;
  let sha: string;
  let ci: { installationId: string; appId: string };
  let other: { installationId: string; appId: string };
  let otherAppNumericId: number;

  const target = { username: 'checks-owner', repo: 'app' };
  const asCi = () => ({ ...target, requesterId: CI_BOT, installation: ci });
  const asOther = () => ({
    ...target,
    requesterId: OTHER_BOT,
    installation: other,
  });

  const eventsOf = (type: string) =>
    db
      .select({ payload: schema.outboxEvent.payload })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repository.id),
          eq(schema.outboxEvent.type, type),
        ),
      );

  async function installApp(slug: string, botUserId: string) {
    const [app] = await db
      .insert(schema.app)
      .values({
        slug,
        name: slug,
        homepageUrl: 'https://example.com',
        permissions: { checks: 'write' },
        events: [],
        ownerUserId: OWNER,
        botUserId,
      })
      .returning({ id: schema.app.id, numericId: schema.app.numericId });
    const [installation] = await db
      .insert(schema.appInstallation)
      .values({
        appId: app.id,
        accountUserId: OWNER,
        repositorySelection: 'all',
        permissions: { checks: 'write' },
        events: [],
      })
      .returning({ id: schema.appInstallation.id });
    return {
      installation: { installationId: installation.id, appId: app.id },
      numericId: app.numericId,
    };
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-checks-'));
    const source = path.join(root, 'source');
    const cache = path.join(root, 'cache.git');
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', cache]);

    const store = new InMemoryWalStore() as unknown as WalStoreService;
    const materializer = new RepositoryMaterializerService(store, {
      getRepoPath: async () => cache,
    } as unknown as RepositoryStorageService);
    const access = new RepositoryAccessService(db);
    const holder = new CommitHolderService(db, materializer);
    checks = new ChecksService(db, access, holder);
    statuses = new CommitStatusesService(db, access, holder);
    commitChecks = new CommitChecksService(db, checks, statuses);

    await db.delete(schema.app).where(like(schema.app.slug, 'ckspec-%'));
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, CI_BOT, OTHER_BOT, READER]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'checks-owner@example.com',
        username: 'checks-owner',
      },
      {
        id: CI_BOT,
        name: 'checks-ci[bot]',
        email: 'checks-ci@example.com',
        username: 'checks-ci[bot]',
      },
      {
        id: READER,
        name: 'Reader',
        email: 'checks-reader@example.com',
        username: 'checks-reader',
      },
      {
        id: OTHER_BOT,
        name: 'checks-other[bot]',
        email: 'checks-other@example.com',
        username: 'checks-other[bot]',
      },
    ]);
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    ({ installation: ci, numericId: ciAppNumericId } = await installApp(
      'ckspec-ci',
      CI_BOT,
    ));
    ({ installation: other, numericId: otherAppNumericId } = await installApp(
      'ckspec-other',
      OTHER_BOT,
    ));

    writeFileSync(path.join(source, 'README.md'), 'hello\n');
    git(source, 'add', '-A');
    git(source, 'commit', '-m', 'first');
    sha = git(source, 'rev-parse', 'HEAD');
    await new PushTransactionService(store, db).commitPush({
      actor: 'system',
      repoId: repository.id,
      transitions: [
        {
          ref: 'refs/heads/main',
          oldOid: ZERO_OID,
          newOid: Buffer.from(sha, 'hex'),
        },
      ],
      body: bufferBody(
        execFileSync('git', ['pack-objects', '--stdout', '--revs'], {
          cwd: source,
          input: 'HEAD\n',
        }),
      ),
      packOffset: 0,
    });
  });

  afterEach(async () => {
    await db
      .delete(schema.repository)
      .where(eq(schema.repository.id, repository.id));
    await db.delete(schema.app).where(like(schema.app.slug, 'ckspec-%'));
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('an installation creates a queued run in a new suite', async () => {
    const run = await checks.createRun(asCi(), { name: 'test', headSha: sha });
    expect(run).toMatchObject({
      name: 'test',
      headSha: sha,
      status: 'queued',
      conclusion: null,
      app: { slug: 'ckspec-ci', deleted: false },
    });
    expect(run.startedAt).not.toBeNull();
    const suites = await db
      .select()
      .from(schema.checkSuite)
      .where(eq(schema.checkSuite.repositoryId, repository.id));
    expect(suites).toHaveLength(1);
    expect(suites[0]).toMatchObject({ status: 'queued', appId: ci.appId });
    expect(await eventsOf('check_run.created')).toEqual([
      { payload: { checkRunId: run.id } },
    ]);
  });

  it('refuses a caller without an installation', async () => {
    await expect(
      checks.createRun(
        { ...target, requesterId: OWNER, installation: null },
        { name: 'test', headSha: sha },
      ),
    ).rejects.toThrow(ChecksNeedInstallationError);
  });

  it('refuses a sha the repository does not hold', async () => {
    await expect(
      checks.createRun(asCi(), { name: 'test', headSha: 'f'.repeat(40) }),
    ).rejects.toThrow(InvalidStatusShaError);
  });

  it('a conclusion completes the run and fires check_run.completed once', async () => {
    const run = await checks.createRun(asCi(), { name: 'test', headSha: sha });
    const done = await checks.updateRun(asCi(), run.id, {
      conclusion: 'failure',
    });
    expect(done).toMatchObject({ status: 'completed', conclusion: 'failure' });
    await checks.updateRun(asCi(), run.id, { conclusion: 'success' });
    expect(await eventsOf('check_run.completed')).toHaveLength(1);
  });

  it('another app cannot update the run', async () => {
    const run = await checks.createRun(asCi(), { name: 'test', headSha: sha });
    await expect(
      checks.updateRun(asOther(), run.id, { conclusion: 'success' }),
    ).rejects.toThrow(NotRunOwnerError);
  });

  it('annotations append across updates and stop at 1000', async () => {
    const run = await checks.createRun(asCi(), { name: 'lint', headSha: sha });
    const annotations = Array.from({ length: 50 }, (_, i) => ({
      path: 'src/a.ts',
      startLine: i + 1,
      endLine: i + 1,
      annotationLevel: 'warning' as const,
      message: `warning ${i}`,
    }));
    for (let i = 0; i < 20; i++)
      await checks.updateRun(asCi(), run.id, {
        output: { title: 'Lint', summary: 'Many', annotations },
      });
    const { total, annotations: page } = await checks.annotations(
      target,
      run.id,
      { offset: 0, limit: 2 },
    );
    expect(total).toBe(1000);
    expect(page.map((a) => a.message)).toEqual(['warning 0', 'warning 1']);
    await expect(
      checks.updateRun(asCi(), run.id, {
        output: {
          title: 'Lint',
          summary: 'Many',
          annotations: annotations.slice(0, 1),
        },
      }),
    ).rejects.toThrow(TooManyAnnotationsError);
    expect((await checks.getRun(target, run.id)).output.annotationsCount).toBe(
      1000,
    );
  });

  it('a suite completes when its newest runs complete, and again after a re-run passes', async () => {
    const first = await checks.createRun(asCi(), {
      name: 'test',
      headSha: sha,
    });
    await checks.updateRun(asCi(), first.id, { conclusion: 'failure' });
    const rerun = await checks.createRun(asCi(), {
      name: 'test',
      headSha: sha,
    });
    const [reopened] = await db
      .select({ status: schema.checkSuite.status })
      .from(schema.checkSuite)
      .where(eq(schema.checkSuite.id, rerun.suiteId));
    expect(reopened.status).toBe('queued');
    await checks.updateRun(asCi(), rerun.id, { conclusion: 'success' });
    const suite = await checks.getSuite(target, rerun.suiteId);
    expect(suite).toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(await eventsOf('check_suite.completed')).toHaveLength(2);
  });

  it('filter=latest returns the newest per app and name, filter=all every run', async () => {
    const old = await checks.createRun(asCi(), { name: 'test', headSha: sha });
    const newer = await checks.createRun(asCi(), {
      name: 'test',
      headSha: sha,
    });
    const theirs = await checks.createRun(asOther(), {
      name: 'test',
      headSha: sha,
    });
    const latest = await checks.runsForRef(target, 'main', {
      filter: 'latest',
      offset: 0,
      limit: 30,
    });
    expect(latest.sha).toBe(sha);
    expect(latest.runs.map((r) => r.id).sort()).toEqual(
      [newer.id, theirs.id].sort(),
    );
    const all = await checks.runsForRef(target, 'main', {
      filter: 'all',
      offset: 0,
      limit: 30,
    });
    expect(all.total).toBe(3);
    expect(all.runs.map((r) => r.id)).toContain(old.id);
    const named = await checks.runsForRef(target, 'main', {
      filter: 'all',
      appId: otherAppNumericId,
      offset: 0,
      limit: 30,
    });
    expect(named.runs.map((r) => r.id)).toEqual([theirs.id]);
  });

  it('latestRunsFor spans repositories, the first repository winning per app and name', async () => {
    const base = await checks.createRun(asCi(), { name: 'test', headSha: sha });
    const [fork] = await db
      .insert(schema.repository)
      .values({
        name: 'fork',
        slug: 'fork',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    try {
      const [suite] = await db
        .insert(schema.checkSuite)
        .values({ repositoryId: fork.id, headSha: sha, appId: ci.appId })
        .returning();
      await db.insert(schema.checkRun).values([
        {
          suiteId: suite.id,
          repositoryId: fork.id,
          headSha: sha,
          name: 'test',
        },
        {
          suiteId: suite.id,
          repositoryId: fork.id,
          headSha: sha,
          name: 'fork-only',
        },
      ]);
      const runs = (
        await checks.latestRunsFor([repository.id, fork.id], [sha])
      ).get(sha);
      expect(runs?.map((r) => r.name).sort()).toEqual(['fork-only', 'test']);
      expect(runs?.find((r) => r.name === 'test')?.id).toBe(base.id);
    } finally {
      await db
        .delete(schema.repository)
        .where(eq(schema.repository.id, fork.id));
    }
  });

  describe('re-runs and actions', () => {
    const asOwner = () => ({
      ...target,
      requesterId: OWNER,
      installation: null,
    });

    it('a writer re-runs a run: one check_run.rerequested, the run unchanged', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await checks.updateRun(asCi(), run.id, { conclusion: 'failure' });
      await checks.rerequestRun(asOwner(), run.id);
      expect(await eventsOf('check_run.rerequested')).toEqual([
        { payload: { checkRunId: run.id } },
      ]);
      expect(await checks.getRun(target, run.id)).toMatchObject({
        status: 'completed',
        conclusion: 'failure',
      });
    });

    it('a writer re-runs a suite', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await checks.rerequestSuite(asOwner(), run.suiteId);
      expect(await eventsOf('check_suite.rerequested')).toEqual([
        { payload: { checkSuiteId: run.suiteId } },
      ]);
    });

    it('a reader cannot re-run', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await expect(
        checks.rerequestRun(
          { ...target, requesterId: READER, installation: null },
          run.id,
        ),
      ).rejects.toThrow(RepositoryForbiddenError);
    });

    it('the owning app may re-request its own run, another app may not', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await checks.rerequestRun(asCi(), run.id);
      await expect(checks.rerequestRun(asOther(), run.id)).rejects.toThrow(
        NotRunOwnerError,
      );
      await expect(
        checks.rerequestSuite(asOther(), run.suiteId),
      ).rejects.toThrow(NotRunOwnerError);
      expect(await eventsOf('check_run.rerequested')).toHaveLength(1);
    });

    it("re-running a deleted app's run is refused", async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await db
        .update(schema.app)
        .set({ deletedAt: new Date() })
        .where(eq(schema.app.id, ci.appId));
      await expect(checks.rerequestRun(asOwner(), run.id)).rejects.toThrow(
        CheckAppGoneError,
      );
      expect((await checks.getRun(target, run.id)).app).toMatchObject({
        deleted: true,
        installed: false,
      });
    });

    it('re-running under a suspended installation is refused', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await db
        .update(schema.appInstallation)
        .set({ suspendedAt: new Date() })
        .where(eq(schema.appInstallation.id, ci.installationId));
      await expect(
        checks.rerequestSuite(asOwner(), run.suiteId),
      ).rejects.toThrow(CheckAppGoneError);
      expect((await checks.getRun(target, run.id)).app.installed).toBe(false);
    });

    it('re-running is refused once the installation no longer covers the repository', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await db
        .update(schema.appInstallation)
        .set({ repositorySelection: 'selected' })
        .where(eq(schema.appInstallation.id, ci.installationId));
      await expect(checks.rerequestRun(asOwner(), run.id)).rejects.toThrow(
        CheckAppGoneError,
      );
      expect((await checks.getRun(target, run.id)).app.installed).toBe(false);
    });

    it('pressing an action sends its identifier', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'lint',
        headSha: sha,
        actions: [
          { label: 'Fix', description: 'Fix the lint', identifier: 'fix' },
        ],
      });
      await checks.requestAction(asOwner(), run.id, 'fix');
      expect(await eventsOf('check_run.requested_action')).toEqual([
        { payload: { checkRunId: run.id, identifier: 'fix' } },
      ]);
    });

    it('an unknown identifier is refused', async () => {
      const run = await checks.createRun(asCi(), {
        name: 'lint',
        headSha: sha,
      });
      await expect(
        checks.requestAction(asOwner(), run.id, 'nope'),
      ).rejects.toThrow(UnknownCheckActionError);
    });
  });

  describe('the commit rollup', () => {
    const status = (
      state: 'success' | 'failure' | 'pending',
      context: string,
    ) =>
      statuses.create({
        ...target,
        requesterId: OWNER,
        sha,
        body: { state, context },
      });
    const finished = async (
      as: ReturnType<typeof asCi>,
      name: string,
      conclusion: Parameters<typeof checks.updateRun>[2]['conclusion'],
    ) => {
      const run = await checks.createRun(as, {
        name,
        headSha: sha,
        ...(conclusion === 'action_required' && {
          detailsUrl: 'https://ci.example.com',
        }),
      });
      return checks.updateRun(as, run.id, { conclusion });
    };
    const rollup = async () =>
      (await commitChecks.checksFor([repository.id], [sha])).get(sha);
    const required = async () =>
      (await commitChecks.requiredChecks(repository.id, [sha])).get(sha);

    it('mixes statuses and runs into one state', async () => {
      await status('success', 'vercel');
      await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
        status: 'in_progress',
      });
      const checksOf = await rollup();
      expect(checksOf?.state).toBe('pending');
      expect(checksOf?.statuses.map((s) => s.context)).toEqual(['vercel']);
      expect(checksOf?.checkRuns.map((r) => r.name)).toEqual(['test']);
    });

    it('a commit with neither has no rollup', async () => {
      expect(await rollup()).toBeUndefined();
    });

    it('a re-run that passes replaces the old failure', async () => {
      await finished(asCi(), 'test', 'failure');
      await finished(asCi(), 'test', 'success');
      const checksOf = await rollup();
      expect(checksOf?.state).toBe('success');
      expect(checksOf?.checkRuns).toHaveLength(1);
    });

    it('shows the same name from two apps as two runs', async () => {
      await finished(asCi(), 'build', 'success');
      await finished(asOther(), 'build', 'failure');
      const checksOf = await rollup();
      expect(checksOf?.checkRuns.map((r) => r.app.slug).sort()).toEqual([
        'ckspec-ci',
        'ckspec-other',
      ]);
      expect(checksOf?.state).toBe('failure');
    });

    it('counts neutral and skipped as passing, action_required as failing', async () => {
      await finished(asCi(), 'a', 'neutral');
      await finished(asCi(), 'b', 'skipped');
      expect((await rollup())?.state).toBe('success');
      await finished(asCi(), 'c', 'action_required');
      expect((await rollup())?.state).toBe('failure');
    });

    it('gives required checks the newest result per name and app, runs and statuses together', async () => {
      await status('failure', 'build');
      await finished(asCi(), 'build', 'success');
      await finished(asOther(), 'build', 'failure');
      const facts = await required();
      // Newest first: the unpinned check takes the first `build`; a pinned one the first from its app.
      expect(facts?.[0]).toEqual({
        context: 'build',
        state: 'failure',
        appId: expect.any(Number),
      });
      expect(facts?.find((f) => f.appId === ciAppNumericId)).toEqual({
        context: 'build',
        state: 'success',
        appId: ciAppNumericId,
      });
      expect(
        facts?.filter((f) => f.appId === null || f.appId === undefined),
      ).toEqual([{ context: 'build', state: 'failure', appId: null }]);
    });

    it("a deleted app's run still renders, but no longer counts as that app's", async () => {
      await finished(asCi(), 'build', 'success');
      await db
        .update(schema.app)
        .set({ deletedAt: new Date() })
        .where(eq(schema.app.id, ci.appId));
      expect((await rollup())?.checkRuns[0]?.app.deleted).toBe(true);
      expect(await required()).toEqual([
        { context: 'build', state: 'success', appId: null },
      ]);
    });

    it('suggests run names next to status contexts for the ruleset form', async () => {
      await status('success', 'vercel');
      await finished(asCi(), 'test', 'success');
      const { contexts } = await statuses.contexts({
        ...target,
        requesterId: OWNER,
      });
      expect(contexts.sort()).toEqual(['test', 'vercel']);
    });
  });

  describe('final review', () => {
    it('creates ten runs at once on one suite without deadlocking', async () => {
      const runs = await Promise.all(
        Array.from({ length: 10 }, (_, n) =>
          checks.createRun(asCi(), { name: `job-${n}`, headSha: sha }),
        ),
      );
      expect(new Set(runs.map((r) => r.suiteId)).size).toBe(1);
      await Promise.all(
        runs.map((r) =>
          checks.updateRun(asCi(), r.id, { conclusion: 'success' }),
        ),
      );
      expect((await checks.getSuite(target, runs[0].suiteId)).conclusion).toBe(
        'success',
      );
    });

    it("a reinstalled app's suite follows its new installation", async () => {
      const first = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await db
        .delete(schema.appInstallation)
        .where(eq(schema.appInstallation.id, ci.installationId));
      const [again] = await db
        .insert(schema.appInstallation)
        .values({
          appId: ci.appId,
          accountUserId: OWNER,
          repositorySelection: 'all',
          permissions: { checks: 'write' },
          events: [],
        })
        .returning({ id: schema.appInstallation.id });
      const reinstalled = { installationId: again.id, appId: ci.appId };
      const second = await checks.createRun(
        { ...target, requesterId: CI_BOT, installation: reinstalled },
        { name: 'test', headSha: sha },
      );
      expect(second.suiteId).toBe(first.suiteId);
      expect(second.app.installed).toBe(true);
      await checks.rerequestRun(
        { ...target, requesterId: OWNER, installation: null },
        second.id,
      );
    });

    it('names the repository each run was posted on, so a fork run is told apart', async () => {
      await checks.createRun(asCi(), { name: 'test', headSha: sha });
      const [fork] = await db
        .insert(schema.repository)
        .values({
          name: 'fork',
          slug: 'fork',
          ownerId: OWNER,
          visibility: 'public',
        })
        .returning();
      try {
        const [suite] = await db
          .insert(schema.checkSuite)
          .values({ repositoryId: fork.id, headSha: sha, appId: ci.appId })
          .returning();
        await db.insert(schema.checkRun).values({
          suiteId: suite.id,
          repositoryId: fork.id,
          headSha: sha,
          name: 'fork-only',
        });
        const runs = (
          await checks.latestRunsFor([repository.id, fork.id], [sha])
        ).get(sha);
        expect(
          Object.fromEntries(runs!.map((r) => [r.name, r.repository])),
        ).toEqual({
          test: { username: 'checks-owner', repo: 'app' },
          'fork-only': { username: 'checks-owner', repo: 'fork' },
        });
      } finally {
        await db
          .delete(schema.repository)
          .where(eq(schema.repository.id, fork.id));
      }
    });

    it('an app cannot win a required check by claiming a future completion time', async () => {
      await checks.createRun(asOther(), {
        name: 'build',
        headSha: sha,
        conclusion: 'success',
        completedAt: new Date('2099-01-01T00:00:00Z'),
      });
      const failing = await checks.createRun(asCi(), {
        name: 'build',
        headSha: sha,
      });
      await checks.updateRun(asCi(), failing.id, { conclusion: 'failure' });
      const facts = (
        await commitChecks.requiredChecks(repository.id, [sha])
      ).get(sha);
      expect(facts?.[0]).toMatchObject({ context: 'build', state: 'failure' });
    });

    it('filter=latest picks the newest run per name before filtering by status', async () => {
      const old = await checks.createRun(asCi(), {
        name: 'test',
        headSha: sha,
      });
      await checks.updateRun(asCi(), old.id, { conclusion: 'failure' });
      await checks.createRun(asCi(), { name: 'test', headSha: sha });
      const { runs } = await checks.runsForRef(target, 'main', {
        filter: 'latest',
        status: 'completed',
        offset: 0,
        limit: 30,
      });
      expect(runs).toEqual([]);
    });
  });
});
