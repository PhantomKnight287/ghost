import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { bufferBody } from '../lib/git/protocol/git-request-body.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
import { CodeSearchService } from '../services/git/code-search/code-search.service.js';
import { IssueReferencesService } from '../services/issues/issue-references.service.js';
import { UnsupportedGitServiceError } from './git.errors.js';
import { GitService } from './git.service.js';

describe('GitService', () => {
  let service: GitService;
  const storage = {
    getRepoPath: vi.fn().mockResolvedValue('/repos/ghost.git'),
  };
  const refAdvertisement = {
    advertise: vi.fn().mockReturnValue(new PassThrough()),
  };
  const packProcess = {
    streamUploadPack: vi.fn().mockReturnValue(new PassThrough()),
    streamReceivePack: vi.fn().mockReturnValue(new PassThrough()),
  };
  const materializer = { materialize: vi.fn().mockResolvedValue(undefined) };
  const pushTransaction = {
    commitPush: vi
      .fn()
      .mockResolvedValue({ seq: 1, ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
  };
  const contributions = {
    sync: vi.fn().mockResolvedValue('55ff3318cbb1ad74a1e1a1e6f4bd91f4b5a9c0d2'),
  };

  const codeSearch = { indexInBackground: vi.fn() };
  const references = { closeFromCommits: vi.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitService,
        { provide: RepositoryStorageService, useValue: storage },
        { provide: RefAdvertisementService, useValue: refAdvertisement },
        { provide: PackProcessService, useValue: packProcess },
        { provide: PushTransactionService, useValue: pushTransaction },
        { provide: RepositoryMaterializerService, useValue: materializer },
        { provide: RepositoryContributionService, useValue: contributions },
        { provide: CodeSearchService, useValue: codeSearch },
        { provide: IssueReferencesService, useValue: references },
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
    expect(materializer.materialize).toHaveBeenCalledWith(
      'repo_ghost',
      '/repos/ghost.git',
      null,
    );
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
    materializer.materialize.mockImplementationOnce(async () => {
      expect(pushTransaction.commitPush).not.toHaveBeenCalled();
    });

    await service.receivePack({
      repositoryId: 'repo_ghost',
      defaultBranch: null,
      isPublic: true,
      body: bufferBody(receivePackBody()),
    });

    expect(materializer.materialize).toHaveBeenCalled();
  });

  it('answers the pre-push probe without touching the log', async () => {
    const { headers } = await service.receivePack({
      repositoryId: 'repo_ghost',
      defaultBranch: null,
      isPublic: true,
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
      repositoryId: 'repo_ghost',
      defaultBranch: null,
      isPublic: true,
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

    const materializeOrder =
      materializer.materialize.mock.invocationCallOrder[0];
    const commitOrder = pushTransaction.commitPush.mock.invocationCallOrder[0];
    const spawnOrder =
      packProcess.streamReceivePack.mock.invocationCallOrder[0];
    expect(materializeOrder).toBeLessThan(commitOrder);
    expect(commitOrder).toBeLessThan(spawnOrder);
  });

  it('indexes contributions once the pushed pack finishes streaming', async () => {
    const { body } = await service.receivePack({
      repositoryId: 'repo_ghost',
      defaultBranch: null,
      isPublic: true,
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
      storage.getRepoPath.mockResolvedValueOnce(path.join(directory, '.git'));
    });

    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    async function push(ref: string) {
      const { body } = await service.receivePack({
        repositoryId: 'repo_ghost',
        defaultBranch: null,
        isPublic: true,
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
) {
  const command = `${old} ${next} ${ref}\0report-status\n`;
  const length = (Buffer.byteLength(command) + 4).toString(16).padStart(4, '0');
  return Buffer.concat([
    Buffer.from(length + command + '0000', 'utf8'),
    Buffer.from('PACKDATA'),
  ]);
}
