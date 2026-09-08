import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';

import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import type { GitRequestBody } from '../services/git/protocol/git-request-body.js';
import {
  isProbeRequest,
  readReceivePackHeader,
} from '../services/git/protocol/receive-pack-request.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { isGitServiceName, type GitServiceName } from './git.constants.js';
import { UnsupportedGitServiceError } from './git.errors.js';

export interface GitTransportResponse {
  headers: Record<string, string>;
  body: Readable;
}

interface RepositoryRef {
  repositoryId: string;
}

@Injectable()
export class GitService {
  constructor(
    private readonly storage: RepositoryStorageService,
    private readonly refAdvertisement: RefAdvertisementService,
    private readonly packProcess: PackProcessService,
    private readonly pushTransaction: PushTransactionService,
    private readonly materializer: RepositoryMaterializerService,
  ) {}

  async advertiseRefs({
    repositoryId,
    service,
  }: RepositoryRef & { service: string }): Promise<GitTransportResponse> {
    if (!isGitServiceName(service)) throw new UnsupportedGitServiceError();

    const repoDirectory = await this.openCache(repositoryId);

    return {
      headers: {
        'Content-Type': `application/x-${service}-advertisement`,
        'Cache-Control': 'no-cache',
      },
      body: this.refAdvertisement.advertise({ repoDirectory, service }),
    };
  }

  async uploadPack({
    repositoryId,
    body,
  }: RepositoryRef & { body: GitRequestBody }): Promise<GitTransportResponse> {
    const repoDirectory = await this.openCache(repositoryId);

    return {
      headers: resultHeaders('git-upload-pack'),
      body: this.packProcess.streamUploadPack({
        repoDirectory,
        input: body.open(),
      }),
    };
  }

  /**
   * `POST /:username/:repo/git-receive-pack` - a push.
   *
   * Materialize first so the local ref checks run against the same state the log
   * holds, then commit, then let git apply the push to the cache. The cache's
   * sequence marker is deliberately left at the pre-push value: whatever git
   * writes locally is a convenience, and the next materialize reconciles it
   * against the log.
   */
  async receivePack({
    repositoryId,
    body,
    pushedBy = null,
  }: RepositoryRef & {
    body: GitRequestBody;
    pushedBy?: string | null;
  }): Promise<GitTransportResponse> {
    if (await isProbeRequest(body)) {
      return {
        headers: resultHeaders('git-receive-pack'),
        body: Readable.from([]),
      };
    }

    const { transitions, packOffset } = await readReceivePackHeader(body);
    const repoDirectory = await this.openCache(repositoryId);

    await this.pushTransaction.commitPush({
      repoId: repositoryId,
      transitions,
      body,
      packOffset,
      pushedBy,
    });

    return {
      headers: resultHeaders('git-receive-pack'),
      body: this.packProcess.streamReceivePack({
        repoDirectory,
        input: body.open(),
      }),
    };
  }

  private async openCache(repositoryId: string) {
    const repoDirectory = await this.storage.getRepoPath(repositoryId);
    await this.materializer.materialize(repositoryId, repoDirectory);
    return repoDirectory;
  }
}

function resultHeaders(service: GitServiceName) {
  return {
    'Content-Type': `application/x-${service}-result`,
    'Cache-Control': 'no-cache',
  };
}
