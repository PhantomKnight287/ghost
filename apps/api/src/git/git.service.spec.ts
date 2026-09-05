import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { bufferBody } from '../services/git/protocol/git-request-body.js';
import { PassThrough } from 'node:stream';

import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
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
      ],
    }).compile();

    service = module.get<GitService>(GitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('materializes the cache before advertising refs', async () => {
    const { headers } = await service.advertiseRefs({
      username: 'phantomknight287',
      repo: 'ghost.git',
      service: 'git-upload-pack',
    });

    expect(headers['Content-Type']).toBe(
      'application/x-git-upload-pack-advertisement',
    );
    expect(materializer.materialize).toHaveBeenCalledWith(
      'phantomknight287/ghost',
      '/repos/ghost.git',
    );
    expect(refAdvertisement.advertise).toHaveBeenCalledWith({
      repoDirectory: '/repos/ghost.git',
      service: 'git-upload-pack',
    });
  });

  it('rejects the dumb protocol', async () => {
    await expect(
      service.advertiseRefs({
        username: 'phantomknight287',
        repo: 'ghost',
        service: '',
      }),
    ).rejects.toBeInstanceOf(UnsupportedGitServiceError);
  });

  it('reads the command section before doing any slower work', async () => {
    materializer.materialize.mockImplementationOnce(async () => {
      expect(pushTransaction.commitPush).not.toHaveBeenCalled();
    });

    await service.receivePack({
      username: 'phantomknight287',
      repo: 'ghost',
      body: bufferBody(receivePackBody()),
    });

    expect(materializer.materialize).toHaveBeenCalled();
  });

  it('answers the pre-push probe without touching the log', async () => {
    const { headers } = await service.receivePack({
      username: 'phantomknight287',
      repo: 'ghost',
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
      username: 'phantomknight287',
      repo: 'ghost',
      body: bufferBody(receivePackBody()),
    });

    expect(headers['Content-Type']).toBe(
      'application/x-git-receive-pack-result',
    );
    expect(pushTransaction.commitPush).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'phantomknight287/ghost' }),
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
});

function receivePackBody() {
  const zero = '0'.repeat(40);
  const next = '55ff3318cbb1ad74a1e1a1e6f4bd91f4b5a9c0d2';
  const command = `${zero} ${next} refs/heads/main\0report-status\n`;
  const length = (Buffer.byteLength(command) + 4).toString(16).padStart(4, '0');
  return Buffer.concat([
    Buffer.from(length + command + '0000', 'utf8'),
    Buffer.from('PACKDATA'),
  ]);
}
