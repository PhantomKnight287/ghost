import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { inArray } from 'drizzle-orm';
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

import { InvalidCursorError } from '../../lib/db/keyset.js';
import { InMemoryWalStore } from '../../lib/git/materializer/wal-store.fake.js';
import { bufferBody } from '../../lib/git/protocol/git-request-body.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import {
  InvalidAssetNameError,
  InvalidTagNameError,
  ReleaseAlreadyExistsError,
  ReleaseAssetExistsError,
  ReleaseAssetNotFoundError,
  ReleaseAssetTooLargeError,
  ReleaseNotFoundError,
  TagNotFoundError,
  TagTargetNotFoundError,
} from '../../lib/releases/releases.errors.js';
import { InMemoryS3 } from '../../lib/s3/s3.fake.js';
import {
  ContentLengthRequiredError,
  StorageQuotaExceededError,
} from '../../lib/storage/storage.errors.js';
import { UserNotFoundError } from '../../lib/users/users.errors.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import type { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import type { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import type { S3Service } from '../../services/s3/s3.service.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ReleaseAssetsService } from './release-assets.service.js';
import { ReleasesService } from './releases.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const OWNER = 'user_release_owner';
const READER = 'user_release_reader';

function git(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('releases', () => {
  let db: Database;
  let pool: Pool;
  let root: string;
  let source: string;
  let cache: string;
  let releases: ReleasesService;
  let assets: ReleaseAssetsService;
  let s3: InMemoryS3;
  let quota: StorageQuotaService;
  let pushes: PushTransactionService;
  let repository: typeof schema.repository.$inferSelect;
  let first: string;
  let second: string;

  const owner = { username: 'release-owner', repo: 'app', requesterId: OWNER };
  const reader = { ...owner, requesterId: READER };
  const anonymous = { username: 'release-owner', repo: 'app' };

  /** Rebuilds the quota and asset services as an instance configured with `env` would have them. */
  function limits(env: Record<string, string>) {
    quota = new StorageQuotaService(db, new ConfigService(env));
    assets = new ReleaseAssetsService(
      db,
      new RepositoryAccessService(db),
      s3 as unknown as S3Service,
      quota,
    );
  }

  function upload(
    releaseId: string,
    name: string,
    bytes: Buffer,
    as: { requesterId: string } = owner,
  ) {
    return assets.upload({
      ...owner,
      ...as,
      releaseId,
      name,
      type: 'application/zip',
      contentLength: String(bytes.length),
      body: Readable.from([bytes]),
    });
  }

  async function commitAndLog(message: string, before: string) {
    writeFileSync(path.join(source, 'README.md'), `${message}\n`);
    git(source, 'add', '-A');
    git(source, 'commit', '-m', message);
    const after = git(source, 'rev-parse', 'HEAD');

    await pushes.commitPush({
      repoId: repository.id,
      transitions: [
        {
          ref: 'refs/heads/main',
          oldOid: before ? Buffer.from(before, 'hex') : ZERO_OID,
          newOid: Buffer.from(after, 'hex'),
        },
      ],
      body: bufferBody(
        execFileSync('git', ['pack-objects', '--stdout', '--revs', '--thin'], {
          cwd: source,
          input: before ? `HEAD\n^${before}\n` : 'HEAD\n',
        }),
      ),
      packOffset: 0,
    });
    return after;
  }

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-releases-'));
    source = path.join(root, 'source');
    cache = path.join(root, 'cache.git');
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', cache]);

    const store = new InMemoryWalStore() as unknown as WalStoreService;
    pushes = new PushTransactionService(store);
    s3 = new InMemoryS3();
    limits({});
    releases = new ReleasesService(
      db,
      new RepositoryAccessService(db),
      new RepositoryMaterializerService(store, {
        getRepoPath: async () => cache,
      } as unknown as RepositoryStorageService),
      pushes,
      new UsersService(db),
      assets,
    );

    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, READER]));
    await db.insert(schema.user).values([
      {
        id: OWNER,
        name: 'Owner',
        email: 'release-owner@example.com',
        username: 'release-owner',
      },
      {
        id: READER,
        name: 'Reader',
        email: 'release-reader@example.com',
        username: 'release-reader',
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

    first = await commitAndLog('first', '');
    second = await commitAndLog('second', first);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  afterAll(async () => {
    await db
      .delete(schema.user)
      .where(inArray(schema.user.id, [OWNER, READER]));
    await pool?.end();
  });

  it('creates a missing tag at the default branch, or at a named target', async () => {
    const onDefault = await releases.createRelease({
      ...owner,
      body: { tagName: 'v2.0', name: 'Two' },
    });
    const onFirst = await releases.createRelease({
      ...owner,
      body: { tagName: 'release/v1.0', target: first.slice(0, 8) },
    });

    expect(onDefault).toMatchObject({
      tagName: 'v2.0',
      name: 'Two',
      commitSha: second,
      authorUsername: 'release-owner',
      isDraft: false,
      viewerCanEdit: true,
    });
    expect(onDefault.publishedAt).not.toBeNull();
    expect(onFirst).toMatchObject({ commitSha: first, name: null });

    // created annotated, so the tag is dated now rather than by its commit
    const created = await listTags(cache);
    expect(created.map((tag) => [tag.name, tag.message])).toEqual(
      expect.arrayContaining([
        ['v2.0', 'Two'],
        ['release/v1.0', 'release/v1.0'],
      ]),
    );
    for (const tag of created) {
      expect(Date.now() - Date.parse(tag.createdAt)).toBeLessThan(60_000);
    }
    await expect(
      releases.getReleaseByTag({ ...anonymous, tagName: 'release/v1.0' }),
    ).resolves.toMatchObject({ commitSha: first, viewerCanEdit: false });
  });

  it('attaches to an existing tag and ignores the target', async () => {
    await releases.createRelease({
      ...owner,
      body: { tagName: 'v1', target: first },
    });
    await releases.deleteRelease({
      ...owner,
      id: (await releases.getReleaseByTag({ ...owner, tagName: 'v1' })).id,
    });

    const again = await releases.createRelease({
      ...owner,
      body: { tagName: 'v1', target: 'main' },
    });
    expect(again.commitSha).toBe(first);
  });

  it('refuses a bad tag name, an unknown target, a duplicate and a reader', async () => {
    await expect(
      releases.createRelease({ ...owner, body: { tagName: 'v1..2' } }),
    ).rejects.toBeInstanceOf(InvalidTagNameError);
    await expect(
      releases.createRelease({
        ...owner,
        body: { tagName: 'v1', target: 'nope' },
      }),
    ).rejects.toBeInstanceOf(TagTargetNotFoundError);

    await releases.createRelease({ ...owner, body: { tagName: 'v1' } });
    await expect(
      releases.createRelease({ ...owner, body: { tagName: 'v1' } }),
    ).rejects.toBeInstanceOf(ReleaseAlreadyExistsError);

    await expect(
      releases.createRelease({ ...reader, body: { tagName: 'v2' } }),
    ).rejects.toThrow();
  });

  it('hides drafts from readers and stamps publishedAt once, on first publish', async () => {
    const draft = await releases.createRelease({
      ...owner,
      body: { tagName: 'v1', isDraft: true },
    });
    expect(draft.publishedAt).toBeNull();

    await expect(
      releases.listReleases({ ...reader, query: {} }),
    ).resolves.toMatchObject({ releases: [] });
    await expect(
      releases.getReleaseByTag({ ...reader, tagName: 'v1' }),
    ).rejects.toBeInstanceOf(ReleaseNotFoundError);

    const published = await releases.updateRelease({
      ...owner,
      id: draft.id,
      body: { isDraft: false, body: 'Notes' },
    });
    expect(published).toMatchObject({ isDraft: false, body: 'Notes' });
    expect(published.publishedAt).not.toBeNull();

    const redrafted = await releases.updateRelease({
      ...owner,
      id: draft.id,
      body: { isDraft: true, name: '' },
    });
    expect(redrafted).toMatchObject({
      isDraft: true,
      name: null,
      publishedAt: published.publishedAt,
    });
  });

  it('marks the newest published non-prerelease as latest', async () => {
    await expect(releases.getLatestRelease(anonymous)).rejects.toBeInstanceOf(
      ReleaseNotFoundError,
    );

    await releases.createRelease({ ...owner, body: { tagName: 'v1' } });
    await releases.createRelease({
      ...owner,
      body: { tagName: 'v2-rc', isPrerelease: true },
    });
    await releases.createRelease({
      ...owner,
      body: { tagName: 'v3', isDraft: true },
    });

    await expect(releases.getLatestRelease(anonymous)).resolves.toMatchObject({
      tagName: 'v1',
      isLatest: true,
    });
    const { releases: listed } = await releases.listReleases({
      ...owner,
      query: {},
    });
    expect(
      listed.map((release) => [release.tagName, release.isLatest]),
    ).toEqual([
      ['v3', false],
      ['v2-rc', false],
      ['v1', true],
    ]);
  });

  it('pages newest first and rejects a malformed cursor', async () => {
    for (const tagName of ['a', 'b', 'c']) {
      await releases.createRelease({ ...owner, body: { tagName } });
    }

    const page = await releases.listReleases({ ...owner, query: { limit: 2 } });
    expect(page.releases.map((release) => release.tagName)).toEqual(['c', 'b']);

    const next = await releases.listReleases({
      ...owner,
      query: { limit: 2, cursor: page.nextCursor! },
    });
    expect(next).toMatchObject({
      releases: [{ tagName: 'a' }],
      nextCursor: null,
    });

    await expect(
      releases.listReleases({ ...owner, query: { cursor: 'nope' } }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('pages by offset in either order, by creation or name, with a total that leaves drafts out for readers', async () => {
    for (const [tagName, name] of [
      ['a', 'Zulu'],
      ['b', null],
      ['c', 'Alpha'],
    ] as const) {
      await releases.createRelease({
        ...owner,
        body: { tagName, ...(name && { name }) },
      });
    }
    await releases.createRelease({
      ...owner,
      body: { tagName: 'd', isDraft: true },
    });

    const created = await releases.pageReleases({
      ...owner,
      offset: 1,
      limit: 2,
      order: { field: 'created', direction: 'desc' },
    });
    expect(created.total).toBe(4);
    expect(created.releases.map((release) => release.tagName)).toEqual([
      'c',
      'b',
    ]);

    // a nameless release sorts by its tag
    const byName = await releases.pageReleases({
      ...reader,
      offset: 0,
      limit: 10,
      order: { field: 'name', direction: 'asc' },
    });
    expect(byName.total).toBe(3);
    expect(byName.releases.map((release) => release.tagName)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('reads a release by id, hiding a draft from readers', async () => {
    const draft = await releases.createRelease({
      ...owner,
      body: { tagName: 'v1', isDraft: true },
    });
    await expect(
      releases.getRelease({ ...owner, id: draft.id }),
    ).resolves.toMatchObject({ tagName: 'v1', isDraft: true });
    await expect(
      releases.getRelease({ ...reader, id: draft.id }),
    ).rejects.toBeInstanceOf(ReleaseNotFoundError);
  });

  it('deletes a tag and keeps its release, refusing a missing tag and a reader', async () => {
    await releases.createRelease({ ...owner, body: { tagName: 'v1' } });
    await expect(
      releases.deleteTag({ ...reader, tagName: 'v1' }),
    ).rejects.toThrow();

    await releases.deleteTag({ ...owner, tagName: 'v1' });
    await expect(
      releases.getReleaseByTag({ ...owner, tagName: 'v1' }),
    ).resolves.toMatchObject({ commitSha: null });
    await expect(
      releases.deleteTag({ ...owner, tagName: 'v1' }),
    ).rejects.toBeInstanceOf(TagNotFoundError);
  });

  it('keeps the tag when a release is deleted, and reports a deleted tag as no commit', async () => {
    const release = await releases.createRelease({
      ...owner,
      body: { tagName: 'v1' },
    });
    await releases.deleteRelease({ ...owner, id: release.id });
    await expect(
      releases.deleteRelease({ ...owner, id: release.id }),
    ).rejects.toBeInstanceOf(ReleaseNotFoundError);

    const again = await releases.createRelease({
      ...owner,
      body: { tagName: 'v1' },
    });
    await pushes.commitPush({
      repoId: repository.id,
      transitions: [
        {
          ref: 'refs/tags/v1',
          oldOid: Buffer.from(git(cache, 'rev-parse', 'refs/tags/v1'), 'hex'),
          newOid: ZERO_OID,
        },
      ],
      body: bufferBody(Buffer.alloc(0)),
      packOffset: 0,
    });

    await expect(
      releases.getReleaseByTag({ ...owner, tagName: 'v1' }),
    ).resolves.toMatchObject({ id: again.id, commitSha: null });
    await expect(
      releases.updateRelease({ ...owner, id: 'release_missing', body: {} }),
    ).rejects.toBeInstanceOf(ReleaseNotFoundError);
  });

  describe('assets', () => {
    let release: Awaited<ReturnType<ReleasesService['createRelease']>>;
    const zip = Buffer.from('PK\u0003\u0004 not really a zip');

    beforeEach(async () => {
      release = await releases.createRelease({
        ...owner,
        body: { tagName: 'v1' },
      });
    });

    it('stores, lists, serves and counts an asset, then deletes it', async () => {
      const asset = await upload(release.id, ' app.zip ', zip);
      expect(asset).toMatchObject({
        name: 'app.zip',
        contentType: 'application/zip',
        size: zip.length,
        downloadCount: 0,
      });

      await expect(
        releases.getReleaseByTag({ ...anonymous, tagName: 'v1' }),
      ).resolves.toMatchObject({ assets: [{ id: asset.id, name: 'app.zip' }] });

      const download = await assets.download({
        ...anonymous,
        asset: { tagName: 'v1', name: 'app.zip' },
      });
      await expect(buffer(download.stream)).resolves.toEqual(zip);
      await expect(
        releases.getReleaseByTag({ ...anonymous, tagName: 'v1' }),
      ).resolves.toMatchObject({ assets: [{ downloadCount: 1 }] });

      await assets.delete({ ...owner, assetId: asset.id });
      expect(s3.objects.size).toBe(0);
      await expect(
        assets.download({
          ...anonymous,
          asset: { tagName: 'v1', name: 'app.zip' },
        }),
      ).rejects.toBeInstanceOf(ReleaseAssetNotFoundError);
      await expect(
        assets.delete({ ...owner, assetId: asset.id }),
      ).rejects.toBeInstanceOf(ReleaseAssetNotFoundError);
    });

    it('refuses a path for a name, a missing length, an oversized file, a duplicate and a reader', async () => {
      await expect(
        upload(release.id, '../app.zip', zip),
      ).rejects.toBeInstanceOf(InvalidAssetNameError);
      await expect(
        assets.upload({
          ...owner,
          releaseId: release.id,
          name: 'app.zip',
          type: undefined,
          contentLength: undefined,
          body: Readable.from([zip]),
        }),
      ).rejects.toBeInstanceOf(ContentLengthRequiredError);

      limits({ RELEASE_ASSET_MAX_BYTES: '8' });
      await expect(upload(release.id, 'app.zip', zip)).rejects.toBeInstanceOf(
        ReleaseAssetTooLargeError,
      );

      limits({});
      await upload(release.id, 'app.zip', zip);
      await expect(upload(release.id, 'app.zip', zip)).rejects.toBeInstanceOf(
        ReleaseAssetExistsError,
      );
      await expect(
        upload(release.id, 'other.zip', zip, { requesterId: READER }),
      ).rejects.toThrow();
      await expect(
        upload('release_missing', 'other.zip', zip),
      ).rejects.toBeInstanceOf(ReleaseNotFoundError);
    });

    it('drops the reservation when the upload fails, so the name and the space are free again', async () => {
      s3.failNextPut = true;
      await expect(upload(release.id, 'app.zip', zip)).rejects.toThrow(
        'connection reset',
      );
      await expect(quota.usageOf({ userId: OWNER }, 'asset')).resolves.toBe(0);
      await expect(upload(release.id, 'app.zip', zip)).resolves.toMatchObject({
        name: 'app.zip',
      });
    });

    it('holds an account to its quota, counting live reservations but not lapsed ones', async () => {
      limits({ ASSET_STORAGE_QUOTA_BYTES: String(zip.length * 2) });
      await upload(release.id, 'a.zip', zip);

      // an upload in flight elsewhere holds its space
      const [inFlight] = await db
        .insert(schema.releaseAsset)
        .values({
          releaseId: release.id,
          repositoryId: repository.id,
          name: 'b.zip',
          contentType: 'application/zip',
          size: zip.length,
        })
        .returning();
      await expect(upload(release.id, 'c.zip', zip)).rejects.toBeInstanceOf(
        StorageQuotaExceededError,
      );

      // one that died a day ago does not, and no longer holds its name either
      await db
        .update(schema.releaseAsset)
        .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
        .where(inArray(schema.releaseAsset.id, [inFlight.id]));
      await expect(upload(release.id, 'b.zip', zip)).resolves.toMatchObject({
        name: 'b.zip',
      });
      await expect(quota.usageOf({ userId: OWNER }, 'asset')).resolves.toBe(
        zip.length * 2,
      );
    });

    it('lets concurrent uploads fill the quota exactly, never past it', async () => {
      limits({ ASSET_STORAGE_QUOTA_BYTES: String(zip.length * 2) });
      const results = await Promise.allSettled(
        ['a', 'b', 'c', 'd'].map((name) =>
          upload(release.id, `${name}.zip`, zip),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(2);
    });

    it('bills an organization repository to the organization, not its owner', async () => {
      limits({ ASSET_STORAGE_QUOTA_BYTES: String(zip.length) });
      await upload(release.id, 'a.zip', zip);

      await db.insert(schema.organization).values({
        id: 'org_release',
        name: 'Release Org',
        slug: 'release-org',
        createdAt: new Date(),
      });
      try {
        await db.insert(schema.member).values({
          id: 'member_release',
          organizationId: 'org_release',
          userId: OWNER,
          role: 'owner',
          createdAt: new Date(),
        });
        await db
          .update(schema.repository)
          .set({ organizationId: 'org_release' })
          .where(inArray(schema.repository.id, [repository.id]));

        await expect(quota.usageOf({ userId: OWNER }, 'asset')).resolves.toBe(
          0,
        );
        await expect(
          quota.usageOf({ organizationId: 'org_release' }, 'asset'),
        ).resolves.toBe(zip.length);
      } finally {
        await db
          .delete(schema.organization)
          .where(inArray(schema.organization.id, ['org_release']));
      }
    });

    it('labels an asset, serves it by id, and renames it unless the name is taken', async () => {
      const asset = await assets.upload({
        ...owner,
        releaseId: release.id,
        name: 'app.zip',
        label: ' Linux build ',
        type: 'application/zip',
        contentLength: String(zip.length),
        body: Readable.from([zip]),
      });
      const other = await upload(release.id, 'other.zip', zip);
      const [row] = await db
        .select({ label: schema.releaseAsset.label })
        .from(schema.releaseAsset)
        .where(inArray(schema.releaseAsset.id, [asset.id]));
      expect(row).toEqual({ label: 'Linux build' });

      const byId = await assets.download({
        ...anonymous,
        asset: { id: asset.id },
      });
      await expect(buffer(byId.stream)).resolves.toEqual(zip);

      await expect(
        assets.update({ ...owner, assetId: asset.id, name: 'other.zip' }),
      ).rejects.toBeInstanceOf(ReleaseAssetExistsError);
      await expect(
        assets.update({ ...owner, assetId: asset.id, name: 'a/b' }),
      ).rejects.toBeInstanceOf(InvalidAssetNameError);
      await expect(
        assets.update({ ...owner, assetId: 'asset_missing', label: 'x' }),
      ).rejects.toBeInstanceOf(ReleaseAssetNotFoundError);
      await expect(
        assets.update({ ...reader, assetId: asset.id, label: 'x' }),
      ).rejects.toThrow();

      await expect(
        assets.update({
          ...owner,
          assetId: asset.id,
          name: 'app-linux.zip',
          label: '',
        }),
      ).resolves.toMatchObject({ id: asset.id, name: 'app-linux.zip' });
      const [renamed] = await db
        .select({ label: schema.releaseAsset.label })
        .from(schema.releaseAsset)
        .where(inArray(schema.releaseAsset.id, [asset.id]));
      expect(renamed).toEqual({ label: null });
      // keeping its own name is not a clash
      await expect(
        assets.update({ ...owner, assetId: other.id, name: 'other.zip' }),
      ).resolves.toMatchObject({ name: 'other.zip' });
    });

    it('hides a draft release asset from readers', async () => {
      const draft = await releases.createRelease({
        ...owner,
        body: { tagName: 'v2', isDraft: true },
      });
      await upload(draft.id, 'app.zip', zip);

      await expect(
        assets.download({
          ...reader,
          asset: { tagName: 'v2', name: 'app.zip' },
        }),
      ).rejects.toBeInstanceOf(ReleaseAssetNotFoundError);
      await expect(
        assets.download({
          ...owner,
          asset: { tagName: 'v2', name: 'app.zip' },
        }),
      ).resolves.toMatchObject({ name: 'app.zip' });
    });

    it('removes stored files with their release', async () => {
      await upload(release.id, 'app.zip', zip);
      await releases.deleteRelease({ ...owner, id: release.id });
      expect(s3.objects.size).toBe(0);
    });

    it('reports usage to the account itself and its organization members only', async () => {
      limits({ STORAGE_QUOTA_BYTES: '1gb', ASSET_STORAGE_QUOTA_BYTES: '2gb' });
      await upload(release.id, 'app.zip', zip);
      const storage = new StorageService(db, quota);

      await expect(storage.usage('release-owner', OWNER)).resolves.toEqual({
        usedBytes: 0,
        quotaBytes: 1024 ** 3,
        maxAssetBytes: 2 * 1024 ** 3,
        fork: { usedBytes: 0, quotaBytes: null },
        lfs: { usedBytes: 0, quotaBytes: null },
        asset: { usedBytes: zip.length, quotaBytes: 2 * 1024 ** 3 },
      });
      await expect(
        storage.usage('release-owner', READER),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });
});
