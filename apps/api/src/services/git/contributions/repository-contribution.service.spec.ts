import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
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

import { DATABASE } from '../../../database/database.module.js';
import { RepositoryContributionService } from './repository-contribution.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../../packages/db/drizzle',
);

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('RepositoryContributionService', () => {
  let db: Database;
  let pool: Pool;
  let service: RepositoryContributionService;
  let root: string;
  let gitDir: string;
  let repositoryId: string;
  let fileSeq = 0;

  function git(...args: string[]) {
    const env = { ...process.env };
    delete env.GIT_DIR;
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env,
    }).trim();
  }

  function commitAs(
    email: string,
    name: string,
    date: string,
    message: string,
  ) {
    fileSeq += 1;
    const file = `file-${fileSeq}.txt`;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), message);
    git('add', file);
    execFileSync('git', ['commit', '-m', message], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
    return git('rev-parse', 'HEAD');
  }

  const sync = () => service.sync({ repositoryId, repoDirectory: gitDir });

  async function dayCounts() {
    const rows = await db
      .select()
      .from(schema.repositoryContribution)
      .where(eq(schema.repositoryContribution.repositoryId, repositoryId));
    return new Map(rows.map((row) => [`${row.authorEmail} ${row.day}`, row]));
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepositoryContributionService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
    service = module.get(RepositoryContributionService);

    await db
      .insert(schema.user)
      .values({
        id: 'user_contribution_spec',
        name: 'Test',
        email: 'contribution-index@example.com',
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(eq(schema.user.id, 'user_contribution_spec'));
    await pool.end();
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-contrib-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    fileSeq = 0;

    const [repository] = await db
      .insert(schema.repository)
      .values({
        name: 'spec',
        slug: `contrib-spec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        ownerId: 'user_contribution_spec',
      })
      .returning();
    repositoryId = repository.id;
  });

  afterEach(async () => {
    rmSync(root, { recursive: true, force: true });
    await db
      .delete(schema.repository)
      .where(eq(schema.repository.id, repositoryId));
  });

  it('buckets commits per author and day', async () => {
    commitAs('alice@example.com', 'Alice', '2026-01-05T12:00:00Z', 'one');
    commitAs('alice@example.com', 'Alice', '2026-01-05T13:00:00Z', 'two');
    commitAs('bob@example.com', 'Bob', '2026-01-06T12:00:00Z', 'three');

    await sync();

    const rows = await dayCounts();
    expect(rows.get('alice@example.com 2026-01-05')?.commits).toBe(2);
    expect(rows.get('bob@example.com 2026-01-06')?.commits).toBe(1);
    expect(rows.get('bob@example.com 2026-01-06')?.authorName).toBe('Bob');
    expect(rows.size).toBe(2);
  });

  it('tops up without recounting after a new push', async () => {
    commitAs('alice@example.com', 'Alice', '2026-02-01T12:00:00Z', 'one');
    await sync();

    commitAs('alice@example.com', 'Alice', '2026-02-02T12:00:00Z', 'two');
    await sync();

    const rows = await dayCounts();
    expect(rows.get('alice@example.com 2026-02-01')?.commits).toBe(1);
    expect(rows.get('alice@example.com 2026-02-02')?.commits).toBe(1);
    expect(rows.size).toBe(2);
  });

  it('rebuilds from scratch after a force push', async () => {
    commitAs('alice@example.com', 'Alice', '2026-03-01T12:00:00Z', 'one');
    commitAs('alice@example.com', 'Alice', '2026-03-02T12:00:00Z', 'two');
    await sync();

    git('reset', '--hard', 'HEAD~1');
    await sync();

    const rows = await dayCounts();
    expect(rows.get('alice@example.com 2026-03-01')?.commits).toBe(1);
    expect(rows.get('alice@example.com 2026-03-02')).toBeUndefined();
    expect(rows.size).toBe(1);
  });

  it('matches emails case-insensitively', async () => {
    commitAs('Alice@Example.COM', 'Alice', '2026-04-01T12:00:00Z', 'one');
    await sync();

    const rows = await dayCounts();
    expect(rows.get('alice@example.com 2026-04-01')?.commits).toBe(1);
  });

  it('links rows to the account matching the author email', async () => {
    await db.insert(schema.user).values({
      id: 'user_contribution_alice',
      name: 'Alice',
      email: 'alice-link@example.com',
    });

    try {
      commitAs(
        'alice-link@example.com',
        'Alice',
        '2026-05-01T12:00:00Z',
        'one',
      );
      commitAs(
        'stranger@example.com',
        'Stranger',
        '2026-05-02T12:00:00Z',
        'two',
      );
      await sync();

      const rows = await dayCounts();
      expect(rows.get('alice-link@example.com 2026-05-01')?.authorId).toBe(
        'user_contribution_alice',
      );
      expect(rows.get('stranger@example.com 2026-05-02')?.authorId).toBeNull();
    } finally {
      await db
        .delete(schema.user)
        .where(eq(schema.user.id, 'user_contribution_alice'));
    }
  });

  it('links rows when the account registers after indexing', async () => {
    commitAs('late@example.com', 'Late', '2026-06-01T12:00:00Z', 'one');
    await sync();

    let rows = await dayCounts();
    expect(rows.get('late@example.com 2026-06-01')?.authorId).toBeNull();

    await db.insert(schema.user).values({
      id: 'user_contribution_late',
      name: 'Late',
      email: 'late@example.com',
    });

    try {
      // No new commits: the sync is a no-op for the walk but still relinks.
      await sync();

      rows = await dayCounts();
      expect(rows.get('late@example.com 2026-06-01')?.authorId).toBe(
        'user_contribution_late',
      );
    } finally {
      await db
        .delete(schema.user)
        .where(eq(schema.user.id, 'user_contribution_late'));
    }
  });

  it("links commits pushed from an account's extra address", async () => {
    await db.insert(schema.user).values({
      id: 'user_contribution_mai',
      name: 'Mai',
      email: 'mai@example.com',
    });
    await db.insert(schema.userEmail).values([
      {
        id: 'uem_spec_verified',
        userId: 'user_contribution_mai',
        email: 'mai-work@example.com',
        verified: true,
      },
      {
        id: 'uem_spec_unverified',
        userId: 'user_contribution_mai',
        email: 'mai-claimed@example.com',
        verified: false,
      },
    ]);

    try {
      commitAs('mai-work@example.com', 'Mai', '2026-06-10T12:00:00Z', 'one');
      commitAs('mai-claimed@example.com', 'Mai', '2026-06-11T12:00:00Z', 'two');
      await sync();

      const rows = await dayCounts();
      expect(rows.get('mai-work@example.com 2026-06-10')?.authorId).toBe(
        'user_contribution_mai',
      );
      // An unverified address is a claim, not proof: it attributes to nobody.
      expect(
        rows.get('mai-claimed@example.com 2026-06-11')?.authorId,
      ).toBeNull();
    } finally {
      await db
        .delete(schema.user)
        .where(eq(schema.user.id, 'user_contribution_mai'));
    }
  });

  it('relinks an address verified after indexing', async () => {
    commitAs('later@example.com', 'Later', '2026-06-20T12:00:00Z', 'one');
    await sync();

    await db.insert(schema.user).values({
      id: 'user_contribution_nils',
      name: 'Nils',
      email: 'nils@example.com',
    });
    await db.insert(schema.userEmail).values({
      id: 'uem_spec_later',
      userId: 'user_contribution_nils',
      email: 'later@example.com',
      verified: true,
    });

    try {
      await sync();

      const rows = await dayCounts();
      expect(rows.get('later@example.com 2026-06-20')?.authorId).toBe(
        'user_contribution_nils',
      );
    } finally {
      await db
        .delete(schema.user)
        .where(eq(schema.user.id, 'user_contribution_nils'));
    }
  });

  describe('listContributors', () => {
    async function seedRow(
      email: string,
      name: string,
      day: string,
      commits: number,
      authorId: string | null = null,
    ) {
      await db.insert(schema.repositoryContribution).values({
        repositoryId,
        authorEmail: email,
        authorName: name,
        day,
        authorId,
        commits,
      });
    }

    it('ranks by commits with the linked account preferred', async () => {
      await db.insert(schema.user).values({
        id: 'user_contribution_zoe',
        name: 'Zoe Account',
        email: 'zoe@example.com',
        username: 'zoe',
      });

      try {
        await seedRow(
          'zoe@example.com',
          'Zoe Git',
          '2026-07-01',
          2,
          'user_contribution_zoe',
        );
        await seedRow(
          'zoe@example.com',
          'Zoe Git',
          '2026-07-03',
          3,
          'user_contribution_zoe',
        );
        await seedRow('stranger@example.com', 'Stranger', '2026-07-02', 10);

        const page = await service.listContributors({ repositoryId });

        expect(page.totalCommits).toBe(15);
        expect(page.totalContributors).toBe(2);
        expect(page.contributors.map((c) => c.authorEmail)).toEqual([
          'stranger@example.com',
          'zoe@example.com',
        ]);

        const [stranger, zoe] = page.contributors;
        expect(stranger.username).toBeNull();
        expect(stranger.authorName).toBe('Stranger');
        expect(zoe.username).toBe('zoe');
        expect(zoe.authorName).toBe('Zoe Account');
        expect(zoe.commits).toBe(5);
        expect(zoe.lastCommittedAt.toISOString()).toBe(
          '2026-07-03T00:00:00.000Z',
        );
      } finally {
        await db
          .delete(schema.user)
          .where(eq(schema.user.id, 'user_contribution_zoe'));
      }
    });

    it('resolves the account over the foreign key', async () => {
      await db.insert(schema.user).values({
        id: 'user_contribution_yara',
        name: 'Yara Account',
        email: 'other@example.com',
        username: 'yara',
        image: 'https://example.com/yara.png',
      });

      try {
        await seedRow(
          'yara-git@example.com',
          'Yara Git',
          '2026-08-01',
          4,
          'user_contribution_yara',
        );

        const page = await service.listContributors({ repositoryId });
        const [yara] = page.contributors;

        // The git email matches no account email: only the FK links her.
        expect(yara.authorEmail).toBe('yara-git@example.com');
        expect(yara.username).toBe('yara');
        expect(yara.authorName).toBe('Yara Account');
        expect(yara.image).toBe('https://example.com/yara.png');
        expect(yara.commits).toBe(4);
      } finally {
        await db
          .delete(schema.user)
          .where(eq(schema.user.id, 'user_contribution_yara'));
      }
    });

    it("folds an account's addresses into one contributor", async () => {
      await db.insert(schema.user).values({
        id: 'user_contribution_wren',
        name: 'Wren Account',
        email: 'wren@example.com',
        username: 'wren',
      });

      try {
        // Same person, two addresses, both linked to the account.
        await seedRow(
          'wren@example.com',
          'Wren Git',
          '2026-10-01',
          2,
          'user_contribution_wren',
        );
        await seedRow(
          'wren-work@example.com',
          'Wren Work',
          '2026-10-05',
          3,
          'user_contribution_wren',
        );

        const page = await service.listContributors({ repositoryId });

        expect(page.contributors).toHaveLength(1);
        expect(page.totalContributors).toBe(1);
        expect(page.contributors[0].commits).toBe(5);
        expect(page.contributors[0].username).toBe('wren');
        // The newest address names the row.
        expect(page.contributors[0].authorEmail).toBe('wren-work@example.com');
      } finally {
        await db
          .delete(schema.user)
          .where(eq(schema.user.id, 'user_contribution_wren'));
      }
    });

    it('honours the limit', async () => {
      await seedRow('a@example.com', 'A', '2026-09-01', 1);
      await seedRow('b@example.com', 'B', '2026-09-01', 2);

      const page = await service.listContributors({
        repositoryId,
        limit: 1,
      });

      expect(page.contributors).toHaveLength(1);
      expect(page.contributors[0].authorEmail).toBe('b@example.com');
      expect(page.totalContributors).toBe(2);
      expect(page.totalCommits).toBe(3);
    });
  });
});
