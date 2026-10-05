import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { bufferBody } from '../lib/git/protocol/git-request-body.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { buffer as readAll } from 'node:stream/consumers';

import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
import { CodeSearchService } from '../services/git/code-search/code-search.service.js';
import { IssueReferencesService } from '../services/issues/issue-references.service.js';
import { PullRefsService } from '../services/git/pull-refs/pull-refs.service.js';
import { ProtectedRefError, UnsupportedGitServiceError } from './git.errors.js';
import { StorageQuotaService } from '../services/storage/storage-quota.service.js';
import { DATABASE } from '../database/database.module.js';
import { GitService } from './git.service.js';

// Verification runs real git over a real pack; it has its own spec, and these bodies are stand-ins.
vi.mock('../lib/git/protocol/verify-push.js', () => ({
  withVerifiedPack: (
    { body, packOffset }: { body: unknown; packOffset: number },
    commit: (pack: { body: unknown; packOffset: number }) => unknown,
  ) => commit({ body, packOffset }),
}));

describe('GitService', () => {
  let service: GitService;
  const refAdvertisement = {
    advertise: vi.fn().mockReturnValue(new PassThrough()),
  };
  const packProcess = {
    streamUploadPack: vi.fn().mockReturnValue(new PassThrough()),
    streamReceivePack: vi.fn().mockReturnValue(new PassThrough()),
  };
  const materializer = { open: vi.fn().mockResolvedValue('/repos/ghost.git') };
  const pushTransaction = {
    commitPush: vi
      .fn()
      .mockResolvedValue({ seq: 1, ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
  };
  const contributions = {
    sync: vi.fn().mockResolvedValue('55ff3318cbb1ad74a1e1a1e6f4bd91f4b5a9c0d2'),
  };

  const codeSearch = { indexInBackground: vi.fn() };
  const pullRefs = { syncAfterPush: vi.fn().mockResolvedValue(undefined) };
  const references = { closeFromCommits: vi.fn().mockResolvedValue(undefined) };
  const published = vi.fn().mockResolvedValue(undefined);
  const runningImports = vi.fn().mockResolvedValue([]);
  const db = {
    insert: () => ({ values: published }),
    select: () => ({ from: () => ({ where: runningImports }) }),
  };
  const logged = vi.fn().mockResolvedValue(undefined);
  const quota = {
    reserve: vi.fn(
      (
        _account: unknown,
        _kind: unknown,
        _bytes: number,
        insert: (tx: unknown) => Promise<unknown>,
      ) => insert({ insert: () => ({ values: logged }) }),
    ),
  };
  const repository = {
    id: 'repo_ghost',
    defaultBranch: null,
    visibility: 'public' as const,
    ownerId: 'user_owner',
    organizationId: null,
    parentRepositoryId: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitService,
        { provide: RefAdvertisementService, useValue: refAdvertisement },
        { provide: PackProcessService, useValue: packProcess },
        { provide: PushTransactionService, useValue: pushTransaction },
        { provide: RepositoryMaterializerService, useValue: materializer },
        { provide: RepositoryContributionService, useValue: contributions },
        { provide: CodeSearchService, useValue: codeSearch },
        { provide: IssueReferencesService, useValue: references },
        { provide: PullRefsService, useValue: pullRefs },
        { provide: StorageQuotaService, useValue: quota },
        { provide: DATABASE, useValue: db },
      ],
    }).compile();

    service = module.get<GitService>(GitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('materializes the cache before advertising refs', async () => {
    const { headers } = await service.advertiseRefs({
      repositoryId: 'repo_ghost',
      defaultBranch: null,
      service: 'git-upload-pack',
    });

    expect(headers['Content-Type']).toBe(
      'application/x-git-upload-pack-advertisement',
    );
    expect(materializer.open).toHaveBeenCalledWith({
      id: 'repo_ghost',
      defaultBranch: null,
    });
    expect(refAdvertisement.advertise).toHaveBeenCalledWith({
      repoDirectory: '/repos/ghost.git',
      service: 'git-upload-pack',
    });
  });

  it('rejects the dumb protocol', async () => {
    await expect(
      service.advertiseRefs({
        repositoryId: 'repo_ghost',
        defaultBranch: null,
        service: '',
      }),
    ).rejects.toBeInstanceOf(UnsupportedGitServiceError);
  });

  it('reads the command section before doing any slower work', async () => {
    materializer.open.mockImplementationOnce(async () => {
      expect(pushTransaction.commitPush).not.toHaveBeenCalled();
    });

    await service.receivePack({
      repository,
      body: bufferBody(receivePackBody()),
    });

    expect(materializer.open).toHaveBeenCalled();
  });

  it('answers the pre-push probe without touching the log', async () => {
    const { headers } = await service.receivePack({
      repository,
      body: bufferBody(Buffer.from('0000')),
    });

    expect(headers['Content-Type']).toBe(
      'application/x-git-receive-pack-result',
    );
    expect(pushTransaction.commitPush).not.toHaveBeenCalled();
    expect(packProcess.streamReceivePack).not.toHaveBeenCalled();
  });

  it('commits to the log before touching the local repository', async () => {
    const { headers } = await service.receivePack({
      repository,
      body: bufferBody(receivePackBody()),
    });

    expect(headers['Content-Type']).toBe(
      'application/x-git-receive-pack-result',
    );
    expect(pushTransaction.commitPush).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'repo_ghost' }),
    );

    const [{ transitions }] = pushTransaction.commitPush.mock.calls[0];
    expect(transitions[0].ref).toBe('refs/heads/main');

    const materializeOrder = materializer.open.mock.invocationCallOrder[0];
    const commitOrder = pushTransaction.commitPush.mock.invocationCallOrder[0];
    const spawnOrder =
      packProcess.streamReceivePack.mock.invocationCallOrder[0];
    expect(materializeOrder).toBeLessThan(commitOrder);
    expect(commitOrder).toBeLessThan(spawnOrder);
  });

  it('bills the pack to its account inside the quota reservation', async () => {
    await service.receivePack({
      repository: { ...repository, parentRepositoryId: 'repo_parent' },
      body: bufferBody(receivePackBody()),
    });

    expect(quota.reserve).toHaveBeenCalledWith(
      { userId: 'user_owner' },
      'fork',
      'PACKDATA'.length,
      expect.any(Function),
    );
    const [{ ulid }] = pushTransaction.commitPush.mock.calls[0];
    expect(logged).toHaveBeenCalledWith({
      repositoryId: 'repo_ghost',
      ulid,
      size: 'PACKDATA'.length,
    });
  });

  it('refuses a push to a pull request ref before it reaches the log, telling the client why', async () => {
    const { body } = await service.receivePack({
      repository,
      body: bufferBody(
        receivePackBody(undefined, undefined, 'refs/pull/1/head'),
      ),
      apiKeyId: 'key_someone',
    });

    expect((await readAll(body)).toString()).toContain(
      `ng refs/pull/1/head ${new ProtectedRefError('refs/pull/1/head').message}\n`,
    );
    expect(pushTransaction.commitPush).not.toHaveBeenCalled();
    expect(packProcess.streamReceivePack).not.toHaveBeenCalled();
  });

  it('throws the refusal to a client that asked for no report', async () => {
    await expect(
      service.receivePack({
        repository,
        body: bufferBody(
          receivePackBody(undefined, undefined, 'refs/pull/1/head', ''),
        ),
      }),
    ).rejects.toBeInstanceOf(ProtectedRefError);
  });

  it('lets an error that is not a refusal through', async () => {
    materializer.open.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      service.receivePack({
        repository,
        body: bufferBody(receivePackBody()),
      }),
    ).rejects.toThrow('disk full');
  });

  it('lets a running import write pull request refs with its own key', async () => {
    runningImports.mockResolvedValueOnce([{ id: 'import_1' }]);

    await service.receivePack({
      repository,
      body: bufferBody(
        receivePackBody(undefined, undefined, 'refs/pull/1/head'),
      ),
      apiKeyId: 'key_import',
    });

    expect(pushTransaction.commitPush).toHaveBeenCalled();
  });

  it('refuses pull request refs to a push with no key, without asking the database', async () => {
    const { body } = await service.receivePack({
      repository,
      body: bufferBody(
        receivePackBody(undefined, undefined, 'refs/pull/1/merge'),
      ),
    });

    expect((await readAll(body)).toString()).toContain('ng refs/pull/1/merge');
    expect(runningImports).not.toHaveBeenCalled();
  });

  it('indexes contributions once the pushed pack finishes streaming', async () => {
    const { body } = await service.receivePack({
      repository,
      body: bufferBody(receivePackBody()),
    });

    expect(contributions.sync).not.toHaveBeenCalled();

    body.emit('close');
    await new Promise((resolve) => setImmediate(resolve));

    expect(contributions.sync).toHaveBeenCalledWith({
      repositoryId: 'repo_ghost',
      repoDirectory: '/repos/ghost.git',
    });
    expect(codeSearch.indexInBackground).toHaveBeenCalledWith({
      repositoryId: 'repo_ghost',
      isPublic: true,
      repoDirectory: '/repos/ghost.git',
    });
    expect(pullRefs.syncAfterPush).toHaveBeenCalledWith({
      repositoryId: 'repo_ghost',
      transitions: [expect.objectContaining({ ref: 'refs/heads/main' })],
    });
    // creating a branch closes nothing
    expect(references.closeFromCommits).not.toHaveBeenCalled();
  });

  describe('closing referenced issues', () => {
    let directory: string;
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'a',
          GIT_AUTHOR_EMAIL: 'a@example.com',
          GIT_COMMITTER_NAME: 'a',
          GIT_COMMITTER_EMAIL: 'a@example.com',
        },
      }).trim();

    beforeEach(() => {
      directory = mkdtempSync(path.join(tmpdir(), 'ghost-close-'));
      git('init', '-q', '-b', 'main');
      git('commit', '-q', '--allow-empty', '-m', 'first');
      git('commit', '-q', '--allow-empty', '-m', 'second', '-m', 'Fixes #1');
      materializer.open.mockResolvedValueOnce(path.join(directory, '.git'));
    });

    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    async function push(ref: string) {
      const { body } = await service.receivePack({
        repository,
        body: bufferBody(
          receivePackBody(
            git('rev-parse', 'HEAD~1'),
            git('rev-parse', 'HEAD'),
            ref,
          ),
        ),
        pushedBy: 'user_pusher',
      });
      body.emit('close');
      await vi.waitFor(() => expect(contributions.sync).toHaveBeenCalled());
    }

    it('hands the commits a default-branch push added to the reference index', async () => {
      await push('refs/heads/main');

      const sha = git('rev-parse', 'HEAD');
      await vi.waitFor(() =>
        expect(references.closeFromCommits).toHaveBeenCalledWith({
          repository: { id: 'repo_ghost' },
          actorId: 'user_pusher',
          commits: [expect.objectContaining({ sha, body: 'Fixes #1' })],
        }),
      );
    });

    it('publishes a push event with the commits the push added', async () => {
      await push('refs/heads/feature');

      const [before, after] = [
        git('rev-parse', 'HEAD~1'),
        git('rev-parse', 'HEAD'),
      ];
      await vi.waitFor(() =>
        expect(published).toHaveBeenCalledWith({
          type: 'push',
          repositoryId: 'repo_ghost',
          actorId: 'user_pusher',
          payload: {
            ref: 'refs/heads/feature',
            before,
            after,
            commits: [
              expect.objectContaining({
                sha: after,
                subject: 'second',
                body: 'Fixes #1',
                authorName: 'a',
              }),
            ],
          },
        }),
      );
    });

    it('publishes nothing for a ref outside branches and tags', async () => {
      await push('refs/notes/commits');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(published).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'push' }),
      );
    });

    it('ignores pushes to other branches', async () => {
      await push('refs/heads/feature');
      // nothing to wait for when nothing happens, so give the hook time to have run
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(references.closeFromCommits).not.toHaveBeenCalled();
    });
  });
});

function receivePackBody(
  old = '0'.repeat(40),
  next = '55ff3318cbb1ad74a1e1a1e6f4bd91f4b5a9c0d2',
  ref = 'refs/heads/main',
  capabilities = 'report-status',
) {
  const command = `${old} ${next} ${ref}\0${capabilities}\n`;
  const length = (Buffer.byteLength(command) + 4).toString(16).padStart(4, '0');
  return Buffer.concat([
    Buffer.from(length + command + '0000', 'utf8'),
    Buffer.from('PACKDATA'),
  ]);
}
