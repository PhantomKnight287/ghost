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

import { InMemoryWalStore } from '../../../lib/git/materializer/wal-store.fake.js';
import { bufferBody } from '../../../lib/git/protocol/git-request-body.js';
import {
  type RefTransition,
  ZERO_OID,
} from '../../../lib/git/wal/wal.types.js';
import type { RefWriter } from '../../../lib/rulesets/rulesets.types.js';
import { PushTransactionService } from './push-transaction.service.js';
import type { WalStoreService } from './wal-store.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../../packages/db/drizzle',
);

const OWNER = 'user_autosuite_owner';
const BOTS = [
  'user_autosuite_ci',
  'user_autosuite_reader',
  'user_autosuite_paused',
];

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('automatic check suites', () => {
  let db: Database;
  let pool: Pool;
  let root: string;
  let source: string;
  let pushes: PushTransactionService;
  let repository: typeof schema.repository.$inferSelect;
  let sha: string;
  let ciAppId: string;

  const user = (transitions: RefTransition[]): RefWriter => ({
    userId: OWNER,
    verdict: {
      transitions,
      write: 'push',
      violations: [],
      bypassed: [],
      suites: [],
    },
  });

  async function push(
    ref: string,
    oid: string,
    actor: (t: RefTransition[]) => RefWriter = user,
    old: string = ZERO_OID.toString('hex'),
  ) {
    const transitions = [
      {
        ref,
        oldOid: Buffer.from(old, 'hex'),
        newOid: Buffer.from(oid, 'hex'),
      },
    ];
    await pushes.commitPush({
      actor: actor(transitions),
      repoId: repository.id,
      transitions,
      body: bufferBody(
        oid === ZERO_OID.toString('hex')
          ? Buffer.alloc(0)
          : execFileSync('git', ['pack-objects', '--stdout', '--revs'], {
              cwd: source,
              input: 'HEAD\n',
            }),
      ),
      packOffset: 0,
    });
    // The hook runs after the push lands and is not awaited by it.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const suites = () =>
    db
      .select({
        appId: schema.checkSuite.appId,
        headSha: schema.checkSuite.headSha,
        headBranch: schema.checkSuite.headBranch,
        before: schema.checkSuite.before,
        after: schema.checkSuite.after,
      })
      .from(schema.checkSuite)
      .where(eq(schema.checkSuite.repositoryId, repository.id));
  const requested = () =>
    db
      .select({ payload: schema.outboxEvent.payload })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repository.id),
          eq(schema.outboxEvent.type, 'check_suite.requested'),
        ),
      );

  async function installApp(
    slug: string,
    botUserId: string,
    checks: 'read' | 'write',
    suspended = false,
  ) {
    const [app] = await db
      .insert(schema.app)
      .values({
        slug,
        name: slug,
        homepageUrl: 'https://example.com',
        permissions: { checks },
        events: [],
        ownerUserId: OWNER,
        botUserId,
      })
      .returning({ id: schema.app.id });
    await db.insert(schema.appInstallation).values({
      appId: app.id,
      accountUserId: OWNER,
      repositorySelection: 'all',
      permissions: { checks },
      events: [],
      suspendedAt: suspended ? new Date() : null,
    });
    return app.id;
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-autosuite-'));
    source = path.join(root, 'source');
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    writeFileSync(path.join(source, 'README.md'), 'hello\n');
    git(source, 'add', '-A');
    git(source, 'commit', '-m', 'first');
    sha = git(source, 'rev-parse', 'HEAD');
    pushes = new PushTransactionService(
      new InMemoryWalStore() as unknown as WalStoreService,
      db,
    );

    await db.delete(schema.app).where(like(schema.app.slug, 'autosuite-%'));
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, ...BOTS]));
    await db.insert(schema.user).values(
      [OWNER, ...BOTS].map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        username: id.replaceAll('_', '-'),
      })),
    );
    [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'app',
        slug: 'app',
        ownerId: OWNER,
        visibility: 'public',
      })
      .returning();
    ciAppId = await installApp('autosuite-ci', BOTS[0], 'write');
    await installApp('autosuite-reader', BOTS[1], 'read');
    await installApp('autosuite-paused', BOTS[2], 'write', true);
  });

  afterEach(async () => {
    await db
      .delete(schema.repository)
      .where(eq(schema.repository.id, repository.id));
    await db.delete(schema.app).where(like(schema.app.slug, 'autosuite-%'));
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('a user push to a branch requests a suite from each live installed app with checks: write', async () => {
    await push('refs/heads/main', sha);
    expect(await suites()).toEqual([
      {
        appId: ciAppId,
        headSha: sha,
        headBranch: 'main',
        before: '0'.repeat(40),
        after: sha,
      },
    ]);
    expect(await requested()).toHaveLength(1);
  });

  it('requests nothing for a tag, a deletion or a system write', async () => {
    await push('refs/tags/v1', sha);
    await push('refs/heads/sys', sha, () => 'system');
    await push('refs/heads/main', sha);
    await push('refs/heads/main', ZERO_OID.toString('hex'), user, sha);
    expect(await suites()).toHaveLength(1);
    expect(await requested()).toHaveLength(1);
  });

  it('pushing the same sha to a second branch requests once', async () => {
    await push('refs/heads/main', sha);
    await push('refs/heads/copy', sha);
    expect(await suites()).toHaveLength(1);
    expect(await requested()).toHaveLength(1);
  });
});
