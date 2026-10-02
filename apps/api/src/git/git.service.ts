import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Readable } from 'node:stream';

import { RepositoryMaterializerService } from '../services/git/materializer/repository-materializer.service.js';
import { PackProcessService } from '../services/git/pack-process/pack-process.service.js';
import type { GitRequestBody } from '../lib/git/protocol/git-request-body.js';
import {
  isProbeRequest,
  readReceivePackHeader,
} from '../lib/git/protocol/receive-pack-request.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { PullRefsService } from '../services/git/pull-refs/pull-refs.service.js';
import { CodeSearchService } from '../services/git/code-search/code-search.service.js';
import { IssueReferencesService } from '../services/issues/issue-references.service.js';
import { listCommits } from '../lib/git/commits/list-commits.js';
import { resolveDefaultRef } from '../lib/git/tree/resolve-ref.js';
import { isPullRef } from '../lib/git/refs/pull-refs.js';
import { type RefTransition, ZERO_OID } from '../lib/git/wal/wal.types.js';
import { MAX_CLOSING_COMMITS } from '../lib/issues/close-issue.js';
import { MAX_PUSH_COMMITS, publishEvent } from '../lib/events/events.js';
import { DATABASE } from '../database/database.module.js';
import { isGitServiceName, type GitServiceName } from './git.constants.js';
import { ProtectedRefError, UnsupportedGitServiceError } from './git.errors.js';

export interface GitTransportResponse {
  headers: Record<string, string>;
  body: Readable;
}

interface RepositoryRef {
  repositoryId: string;
  defaultBranch: string | null;
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  constructor(
    private readonly refAdvertisement: RefAdvertisementService,
    private readonly packProcess: PackProcessService,
    private readonly pushTransaction: PushTransactionService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly contributions: RepositoryContributionService,
    private readonly codeSearch: CodeSearchService,
    private readonly references: IssueReferencesService,
    private readonly pullRefs: PullRefsService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async advertiseRefs({
    repositoryId,
    defaultBranch,
    service,
    protocol,
  }: RepositoryRef & {
    service: string;
    protocol?: string;
  }): Promise<GitTransportResponse> {
    if (!isGitServiceName(service)) throw new UnsupportedGitServiceError();

    const repoDirectory = await this.materializer.open({
      id: repositoryId,
      defaultBranch,
    });

    return {
      headers: {
        'Content-Type': `application/x-${service}-advertisement`,
        'Cache-Control': 'no-cache',
      },
      body: this.refAdvertisement.advertise({
        repoDirectory,
        service,
        protocol,
      }),
    };
  }

  async uploadPack({
    repositoryId,
    defaultBranch,
    body,
    protocol,
  }: RepositoryRef & {
    body: GitRequestBody;
    protocol?: string;
  }): Promise<GitTransportResponse> {
    const repoDirectory = await this.materializer.open({
      id: repositoryId,
      defaultBranch,
    });

    return {
      headers: resultHeaders('git-upload-pack'),
      body: this.packProcess.streamUploadPack({
        repoDirectory,
        input: body.open(),
        protocol,
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
    defaultBranch,
    isPublic,
    body,
    pushedBy = null,
    apiKeyId = null,
  }: RepositoryRef & {
    isPublic: boolean;
    body: GitRequestBody;
    pushedBy?: string | null;
    /** The key an HTTP push authenticated with; only the key minted for a running import may write `refs/pull/*`. */
    apiKeyId?: string | null;
  }): Promise<GitTransportResponse> {
    if (await isProbeRequest(body)) {
      return {
        headers: resultHeaders('git-receive-pack'),
        body: Readable.from([]),
      };
    }

    const { transitions, packOffset } = await readReceivePackHeader(body);
    // Checked before the log: receive-pack's own refusals land after the commit point, too late to keep a ref out.
    const pullRef = transitions.find(({ ref }) => isPullRef(ref));
    if (pullRef && !(await this.isImportKey(repositoryId, apiKeyId))) {
      throw new ProtectedRefError(pullRef.ref);
    }
    const repoDirectory = await this.materializer.open({
      id: repositoryId,
      defaultBranch,
    });

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

    // Fire-and-forget: a push must not wait on a history walk or a reindex, and an interrupted index leaves a cursor the next sync tops up.
    result.once('close', () => {
      this.codeSearch.indexInBackground({
        repositoryId,
        isPublic,
        repoDirectory,
      });
      this.contributions
        .sync({ repositoryId, repoDirectory })
        .catch((error: unknown) =>
          this.logger.warn(
            `Contribution index update failed for ${repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      this.closeFromPush({
        repositoryId,
        repoDirectory,
        transitions,
        pushedBy,
      }).catch((error: unknown) =>
        this.logger.warn(
          `Closing referenced issues failed for ${repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      void this.pullRefs.syncAfterPush({ repositoryId, transitions });
      this.publishPushes({
        repositoryId,
        repoDirectory,
        transitions,
        pushedBy,
      }).catch((error: unknown) =>
        this.logger.warn(
          `Publishing push events failed for ${repositoryId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    return {
      headers: resultHeaders('git-receive-pack'),
      body: result,
    };
  }

  /** Published after the push, not with it: refs live in object storage, outside any database transaction, so a crash in between loses the event but never invents one. */
  private async publishPushes({
    repositoryId,
    repoDirectory,
    transitions,
    pushedBy,
  }: Pick<RepositoryRef, 'repositoryId'> & {
    repoDirectory: string;
    transitions: RefTransition[];
    pushedBy: string | null;
  }) {
    // Branches and tags only, as GitHub sends them: an import pushes a `refs/pull/*` ref per pull request, which nobody subscribes to.
    const published = transitions.filter(
      ({ ref }) =>
        ref.startsWith('refs/heads/') || ref.startsWith('refs/tags/'),
    );
    for (const { ref, oldOid, newOid } of published) {
      const before = oldOid.toString('hex');
      const after = newOid.toString('hex');
      const { commits } = newOid.equals(ZERO_OID)
        ? { commits: [] }
        : await listCommits({
            gitDir: repoDirectory,
            // a new ref lists from its tip, since there is no old one to start after
            ref: oldOid.equals(ZERO_OID) ? after : `${before}..${after}`,
            limit: MAX_PUSH_COMMITS,
          });
      await publishEvent(this.db, {
        type: 'push',
        repositoryId,
        actorId: pushedBy,
        payload: {
          ref,
          before,
          after,
          commits,
        },
      });
    }
  }

  /** Commits that moved the default branch forward close the issues they name, like GitHub's `Fixes #1`. */
  private async closeFromPush({
    repositoryId,
    repoDirectory,
    transitions,
    pushedBy,
  }: Pick<RepositoryRef, 'repositoryId'> & {
    repoDirectory: string;
    transitions: RefTransition[];
    pushedBy: string | null;
  }) {
    const defaultRef = await resolveDefaultRef({ gitDir: repoDirectory });
    const pushed = transitions.find(
      (transition) => transition.ref === defaultRef,
    );
    // ponytail: creating or deleting the default branch closes nothing; the first push of a whole history would otherwise close every issue it ever fixed.
    if (
      !pushed ||
      pushed.oldOid.equals(ZERO_OID) ||
      pushed.newOid.equals(ZERO_OID)
    )
      return;

    const { commits } = await listCommits({
      gitDir: repoDirectory,
      ref: `${pushed.oldOid.toString('hex')}..${pushed.newOid.toString('hex')}`,
      limit: MAX_CLOSING_COMMITS,
    });
    await this.references.closeFromCommits({
      repository: { id: repositoryId },
      actorId: pushedBy,
      commits,
    });
  }

  private async isImportKey(repositoryId: string, apiKeyId: string | null) {
    if (!apiKeyId) return false;
    const [running] = await this.db
      .select({ id: schema.repositoryImport.id })
      .from(schema.repositoryImport)
      .where(
        and(
          eq(schema.repositoryImport.repositoryId, repositoryId),
          eq(schema.repositoryImport.apiKeyId, apiKeyId),
          eq(schema.repositoryImport.status, 'running'),
        ),
      );
    return Boolean(running);
  }
}

function resultHeaders(service: GitServiceName) {
  return {
    'Content-Type': `application/x-${service}-result`,
    'Cache-Control': 'no-cache',
  };
}
