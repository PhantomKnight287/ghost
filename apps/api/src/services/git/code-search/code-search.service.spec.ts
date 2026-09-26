import type { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeSearchUnavailableError } from '../../../lib/git/code-search/code-search.errors.js';
import {
  indexRepository,
  searchIndex,
  type CodeSearchHit,
} from '../../../lib/git/code-search/zoekt.js';
import type { S3Service } from '../../s3/s3.service.js';
import { CodeSearchService } from './code-search.service.js';

vi.mock('../../../lib/git/code-search/zoekt.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../lib/git/code-search/zoekt.js')
  >()),
  indexRepository: vi.fn(),
  searchIndex: vi.fn(),
}));

const URL = 'http://zoekt:6070';
const MARKER = 'zoekt-state/repo_a';
const stamp = (head: string, visibility = 'public') => `${head} ${visibility}`;

function fakeS3() {
  const objects = new Map<string, string>();
  const calls: string[] = [];
  return {
    objects,
    calls,
    bucket: 'ghost',
    getObject: vi.fn(async ({ Key }: { Key: string }) => {
      const body = objects.get(Key);
      if (body === undefined) {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      }
      return { Body: { transformToString: async () => body } };
    }),
    putObject: vi.fn(
      async ({ Key, Body }: { Key: string; Body: string | Readable }) => {
        calls.push(`put ${Key}`);
        objects.set(Key, typeof Body === 'string' ? Body : await text(Body));
      },
    ),
    deleteUnder: vi.fn(async (prefix: string, keep: string[]) => {
      calls.push(`delete ${prefix}`);
      for (const key of objects.keys()) {
        if (key.startsWith(prefix) && !keep.includes(key)) objects.delete(key);
      }
    }),
  };
}

const hit = (repositoryId: string): CodeSearchHit => ({
  repositoryId,
  commit: 'c1',
  path: 'a.ts',
  language: 'TypeScript',
  lines: [],
});

describe('CodeSearchService', () => {
  let root: string;
  let repo: string;
  let s3: ReturnType<typeof fakeS3>;

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: path.join(root, 'work') })
      .toString()
      .trim();
  const commit = (content: string) => {
    writeFileSync(path.join(root, 'work', 'a.ts'), content);
    git('add', '.');
    git('commit', '-qm', content);
    git('push', '-q', repo, 'HEAD:refs/heads/main');
    return git('rev-parse', 'HEAD');
  };
  const service = (config: Record<string, string> = { ZOEKT_URL: URL }) =>
    new CodeSearchService(
      { get: (key: string) => config[key] } as unknown as ConfigService,
      s3 as unknown as S3Service,
    );
  const target = () => ({
    repositoryId: 'repo_a',
    isPublic: true,
    repoDirectory: repo,
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-code-search-'));
    repo = path.join(root, 'repo_a.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', repo]);
    execFileSync('git', ['init', '-q', '-b', 'main', path.join(root, 'work')]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    s3 = fakeS3();
    vi.mocked(indexRepository)
      .mockReset()
      .mockImplementation(async ({ indexDir }) => {
        writeFileSync(path.join(indexDir, 'repo_a_v16.00000.zoekt'), 'shard');
        return ['repo_a_v16.00000.zoekt'];
      });
    vi.mocked(searchIndex).mockReset().mockResolvedValue([]);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('index', () => {
    it('does nothing when code search is off', async () => {
      commit('one');

      await service({}).index(target());

      expect(indexRepository).not.toHaveBeenCalled();
      expect(s3.getObject).not.toHaveBeenCalled();
    });

    it('does nothing for an empty repository', async () => {
      await service().index(target());

      expect(indexRepository).not.toHaveBeenCalled();
    });

    it('publishes the shards, drops stale ones, then moves the marker', async () => {
      const head = commit('one');
      s3.objects.set('zoekt/repo_a_v16.00001.zoekt', 'stale');

      await service().index({ ...target(), isPublic: false });

      expect(indexRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          repoDirectory: repo,
          name: 'repo_a',
          isPublic: false,
        }),
      );
      expect(s3.calls).toEqual([
        'put zoekt/repo_a_v16.00000.zoekt',
        'delete zoekt/repo_a_v',
        `put ${MARKER}`,
      ]);
      expect(Object.fromEntries(s3.objects)).toEqual({
        'zoekt/repo_a_v16.00000.zoekt': 'shard',
        [MARKER]: stamp(head, 'private'),
      });
    });

    it('skips a HEAD that is already published', async () => {
      s3.objects.set(MARKER, stamp(commit('one')));

      await service().index(target());

      expect(indexRepository).not.toHaveBeenCalled();
    });

    it('republishes when only the visibility changed', async () => {
      const head = commit('one');
      s3.objects.set(MARKER, stamp(head, 'private'));

      await service().index(target());

      expect(indexRepository).toHaveBeenCalledWith(
        expect.objectContaining({ isPublic: true }),
      );
      expect(s3.objects.get(MARKER)).toBe(stamp(head));
    });

    it('remembers a published HEAD instead of asking S3 again', async () => {
      commit('one');
      const search = service();

      await search.index(target());
      await search.index(target());

      expect(indexRepository).toHaveBeenCalledTimes(1);
      expect(s3.getObject).toHaveBeenCalledTimes(1);
    });

    it('remembers a HEAD S3 confirmed as published', async () => {
      s3.objects.set(MARKER, stamp(commit('one')));
      const search = service();

      await search.index(target());
      await search.index(target());

      expect(s3.getObject).toHaveBeenCalledTimes(1);
    });

    it('queues one rerun for the calls made while a run is in flight', async () => {
      commit('one');
      let second = '';
      const search = service();
      vi.mocked(indexRepository).mockImplementationOnce(
        async ({ indexDir }) => {
          second = commit('two');
          void search.index(target());
          void search.index(target());
          writeFileSync(path.join(indexDir, 'repo_a_v16.00000.zoekt'), 'old');
          return ['repo_a_v16.00000.zoekt'];
        },
      );

      await search.index(target());

      expect(indexRepository).toHaveBeenCalledTimes(2);
      expect(s3.objects.get(MARKER)).toBe(stamp(second));
    });

    it('fails when the marker cannot be read', async () => {
      commit('one');
      s3.getObject.mockRejectedValueOnce(new Error('S3 is down'));

      await expect(service().index(target())).rejects.toThrow('S3 is down');
    });

    it('removes its scratch directory when indexing fails', async () => {
      commit('one');
      let indexDir = '';
      vi.mocked(indexRepository).mockImplementationOnce(async (options) => {
        indexDir = options.indexDir;
        throw new Error('zoekt-git-index failed');
      });

      await expect(service().index(target())).rejects.toThrow();

      expect(existsSync(indexDir)).toBe(false);
      expect(s3.objects.has(MARKER)).toBe(false);
    });
  });

  describe('indexInBackground', () => {
    it('swallows a failed index', async () => {
      commit('one');
      vi.mocked(indexRepository).mockRejectedValueOnce(new Error('boom'));

      service().indexInBackground(target());

      await vi.waitFor(() => expect(indexRepository).toHaveBeenCalled());
    });
  });

  describe('searchRepository', () => {
    const search = (on: CodeSearchService, query = 'x') =>
      on.searchRepository({ ...target(), query, limit: 10 });

    it('is unavailable when code search is off', async () => {
      await expect(search(service({}))).rejects.toBeInstanceOf(
        CodeSearchUnavailableError,
      );
    });

    it('reports and starts indexing when HEAD is not published', async () => {
      const head = commit('one');

      const { indexing } = await search(service());

      expect(indexing).toBe(true);
      await vi.waitFor(() => expect(s3.objects.get(MARKER)).toBe(stamp(head)));
    });

    it('reports indexing while a run is in flight', async () => {
      commit('one');
      let finish!: () => void;
      vi.mocked(indexRepository).mockImplementationOnce(
        () => new Promise((resolve) => (finish = () => resolve([]))),
      );
      const on = service();
      const run = on.index(target());
      await vi.waitFor(() => expect(indexRepository).toHaveBeenCalled());

      const { indexing } = await search(on);
      finish();
      await run;

      expect(indexing).toBe(true);
    });

    it('does not index a HEAD that is already published', async () => {
      s3.objects.set(MARKER, stamp(commit('one')));

      const { indexing } = await search(service());

      expect(indexing).toBe(false);
      expect(indexRepository).not.toHaveBeenCalled();
      expect(searchIndex).toHaveBeenCalledWith({
        url: URL,
        query: 'r:^repo_a$ (x)',
        limit: 10,
      });
    });

    it('drops hits from other repositories', async () => {
      s3.objects.set(MARKER, stamp(commit('one')));
      vi.mocked(searchIndex).mockResolvedValue([hit('repo_a'), hit('repo_b')]);

      const { files } = await search(service(), 'x) or (r:repo_b');

      expect(files).toEqual([hit('repo_a')]);
    });
  });

  describe('searchPublic', () => {
    it('is unavailable when code search is off', async () => {
      await expect(
        service({}).searchPublic({ query: 'x', limit: 10 }),
      ).rejects.toBeInstanceOf(CodeSearchUnavailableError);
    });

    it('narrows the query to public shards', async () => {
      vi.mocked(searchIndex).mockResolvedValue([hit('repo_a')]);

      await expect(
        service().searchPublic({ query: 'x', limit: 10 }),
      ).resolves.toEqual([hit('repo_a')]);
      expect(searchIndex).toHaveBeenCalledWith({
        url: URL,
        query: 'public:yes (x)',
        limit: 10,
      });
    });
  });
});
