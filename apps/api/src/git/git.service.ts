import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';

import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import type { GitRequestBody } from '../lib/git/protocol/git-request-body.js';
import {
  isProbeRequest,
  readReceivePackHeader,
} from '../lib/git/protocol/receive-pack-request.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryStorageService } from '../services/git/repository-storage/repository-storage.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
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
  private readonly logger = new Logger(GitService.name);

  constructor(
    private readonly storage: RepositoryStorageService,
    private readonly refAdvertisement: RefAdvertisementService,
    private readonly packProcess: PackProcessService,
    private readonly pushTransaction: PushTransactionService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly contributions: RepositoryContributionService,
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
   * Materialize before the ref checks so they see what the log holds. The cache keeps its pre-push sequence marker; the next materialize reconciles whatever git wrote locally.
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

    const result = this.packProcess.streamReceivePack({
      repoDirectory,
      input: body.open(),
    });

    // Fire-and-forget: a push must not wait on a history walk, and an interrupted index leaves a cursor the next sync tops up.
    result.once('close', () => {
      this.contributions
        .sync({ repositoryId, repoDirectory })
        .catch((error: unknown) =>
          this.logger.warn(
            `Contribution index update failed for ${repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    });

    return {
      headers: resultHeaders('git-receive-pack'),
      body: result,
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
