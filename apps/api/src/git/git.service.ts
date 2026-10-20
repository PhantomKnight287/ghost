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
import { withVerifiedPack } from '../lib/git/protocol/verify-push.js';
import { RefAdvertisementService } from '../services/git/ref-advertisement/ref-advertisement.service.js';
import { RepositoryContributionService } from '../services/git/contributions/repository-contribution.service.js';
import { PushTransactionService } from '../services/git/wal/push-transaction.service.js';
import { PullRefsService } from '../services/git/pull-refs/pull-refs.service.js';
import { PullRequestPushesService } from '../services/pull-requests/pull-request-pushes.service.js';
import { PullRequestHintsService } from '../services/pull-requests/pull-request-hints.service.js';
import { CodeSearchService } from '../services/git/code-search/code-search.service.js';
import { StorageQuotaService } from '../services/storage/storage-quota.service.js';
import { IssueReferencesService } from '../services/issues/issue-references.service.js';
import { listCommits } from '../lib/git/commits/list-commits.js';
import { resolveDefaultRef } from '../lib/git/tree/resolve-ref.js';
import { isPullRef } from '../lib/git/refs/pull-refs.js';
import { type RefTransition, ZERO_OID } from '../lib/git/wal/wal.types.js';
import { createUlid } from '../lib/git/wal/ulid.js';
import type { Repository } from '../lib/repositories/access/repository-access.js';
import {
  storageAccountOf,
  billedKindOf,
} from '../lib/storage/storage-account.js';
import { MAX_CLOSING_COMMITS } from '../lib/issues/close-issue.js';
import { MAX_PUSH_COMMITS, publishEvent } from '../lib/events/events.js';
import { DATABASE } from '../database/database.module.js';
import {
  isGitServiceName,
  type GitServiceName,
} from '../lib/git/protocol/git-service.js';
import {
  ProtectedRefError,
  UnsupportedGitServiceError,
} from '../lib/git/git.errors.js';
import { DomainError } from '../domain/errors.js';
import { rejectedPushReport } from '../lib/git/protocol/report-status.js';
import { withRemoteMessages } from '../lib/git/protocol/side-band.js';
import { errorMessage } from '../lib/error-message.js';
import { refTargeted } from '../lib/rulesets/ref-pattern.js';
import { RulesetViolationError } from '../lib/rulesets/rulesets.errors.js';
import type { Violation } from '../lib/rulesets/rulesets.types.js';
import { RulesetVerdictsService } from '../services/rulesets/ruleset-verdicts.service.js';

export interface GitTransportResponse {
  headers: Record<string, string>;
  body: Readable;
}

interface RepositoryRef {
  repository: { id: string; defaultBranch: string | null };
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
    private readonly pullRequestPushes: PullRequestPushesService,
    private readonly pullRequestHints: PullRequestHintsService,
    private readonly quota: StorageQuotaService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly verdicts: RulesetVerdictsService,
  ) {}

  async advertiseRefs({
    repository,
    service,
    protocol,
  }: RepositoryRef & {
    service: string;
    protocol?: string;
  }): Promise<GitTransportResponse> {
    if (!isGitServiceName(service)) throw new UnsupportedGitServiceError();

    const repoDirectory = await this.materializer.open(repository);

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
    repository,
    body,
    protocol,
  }: RepositoryRef & {
    body: GitRequestBody;
    protocol?: string;
  }): Promise<GitTransportResponse> {
    const repoDirectory = await this.materializer.open(repository);

    return {
      headers: resultHeaders('git-upload-pack'),
      body: this.packProcess.streamUploadPack({
        repoDirectory,
        input: body.open(),
        protocol,
      }),
    };
  }

  /** A push. Materializes before the ref checks so they see what the log holds; the next materialize reconciles whatever git wrote locally. */
  async receivePack({
    repository,
    body,
    pushedBy = null,
    apiKeyId = null,
  }: {
    repository: Pick<
      Repository,
      | 'id'
      | 'defaultBranch'
      | 'visibility'
      | 'ownerId'
      | 'organizationId'
      | 'parentRepositoryId'
    >;
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

    const { id: repositoryId } = repository;
    const isPublic = repository.visibility === 'public';
    const { transitions, capabilities, packOffset } =
      await readReceivePackHeader(body);
    let importing: boolean;
    let repoDirectory: string;
    try {
      ({ importing, repoDirectory } = await this.commitToLog({
        repository,
        transitions,
        body,
        packOffset,
        pushedBy,
        apiKeyId,
      }));
    } catch (error) {
      // Every refusal lands before the log commits, so the client is told per ref, the way git itself refuses one, instead of seeing a dropped connection.
      const report =
        error instanceof RulesetViolationError
          ? rejectedPushReport({
              refs: transitions.map(({ ref }) => ref),
              capabilities,
              reason: 'push declined due to repository rule violations',
              lines: ruleViolationLines(error.violations),
            })
          : error instanceof DomainError
            ? rejectedPushReport({
                refs: transitions.map(({ ref }) => ref),
                capabilities,
                reason: error.message,
              })
            : null;
      if (!report) throw error;
      return {
        headers: resultHeaders('git-receive-pack'),
        body: Readable.from([report]),
      };
    }

    // ponytail: hints follow the commands, not receive-pack's report, so a ref it refuses after the log commit still gets one; read the report if that misleads anyone.
    const hints = importing
      ? Promise.resolve([])
      : this.pullRequestHints.hintsFor({
          repositoryId,
          repoDirectory,
          transitions,
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
            `Contribution index update failed for ${repositoryId}: ${errorMessage(error)}`,
          ),
        );
      this.closeFromPush({
        repositoryId,
        repoDirectory,
        transitions,
        pushedBy,
      }).catch((error: unknown) =>
        this.logger.warn(
          `Closing referenced issues failed for ${repositoryId}: ${errorMessage(error)}`,
        ),
      );
      void this.pullRefs.syncAfterPush({ repositoryId, transitions });
      // An import is history, not activity: its push names every branch and tag the repository ever had.
      if (importing) return;
      this.db
        .update(schema.repository)
        .set({ lastPushedAt: new Date() })
        .where(eq(schema.repository.id, repositoryId))
        .catch((error: unknown) =>
          this.logger.warn(
            `Recording the push time failed for ${repositoryId}: ${errorMessage(error)}`,
          ),
        );
      void this.pullRequestPushes.recordPush({
        repositoryId,
        transitions,
        pushedBy,
      });
      this.publishPushes({
        repositoryId,
        repoDirectory,
        transitions,
        pushedBy,
      }).catch((error: unknown) =>
        this.logger.warn(
          `Publishing push events failed for ${repositoryId}: ${errorMessage(error)}`,
        ),
      );
    });

    return {
      headers: resultHeaders('git-receive-pack'),
      body: withRemoteMessages(result, { lines: await hints, capabilities }),
    };
  }

  /** Checks, bills and commits a push to the log. Checked before the log: receive-pack's own refusals land after the commit point, too late to keep a ref out. */
  private async commitToLog({
    repository,
    transitions,
    body,
    packOffset,
    pushedBy,
    apiKeyId,
  }: {
    repository: Pick<
      Repository,
      | 'id'
      | 'defaultBranch'
      | 'ownerId'
      | 'organizationId'
      | 'parentRepositoryId'
    >;
    transitions: RefTransition[];
    body: GitRequestBody;
    packOffset: number;
    pushedBy: string | null;
    apiKeyId: string | null;
  }) {
    const repositoryId = repository.id;
    const importing = await this.isImportKey(repositoryId, apiKeyId);
    const pullRef = transitions.find(({ ref }) => isPullRef(ref));
    if (pullRef && !importing) {
      throw new ProtectedRefError(pullRef.ref);
    }
    const repoDirectory = await this.materializer.open({
      id: repositoryId,
      defaultBranch: repository.defaultBranch,
    });
    const rulesets = await this.verdicts.active(repositoryId);
    const defaultBranch =
      rulesets.length > 0
        ? await this.verdicts.defaultBranchOf(repository, repoDirectory)
        : '';
    // Only these rules need git to answer, so a repository without them runs no extra command.
    const factsFor = new Set(
      transitions
        .filter(({ ref }) =>
          rulesets.some(
            (ruleset) =>
              ruleset.rules.some(
                ({ type }) =>
                  type === 'non_fast_forward' ||
                  type === 'required_linear_history',
              ) && refTargeted(ruleset, ref, defaultBranch),
          ),
        )
        .map(({ ref }) => ref),
    );

    await withVerifiedPack(
      { gitDir: repoDirectory, transitions, body, packOffset, factsFor },
      async ({ facts, ...pack }) => {
        const verdict = await this.verdicts.judge({
          repository,
          gitDir: repoDirectory,
          userId: pushedBy,
          write: 'push',
          transitions,
          facts,
          rulesets,
        });
        if (verdict.violations.length > 0)
          throw new RulesetViolationError(verdict.violations);
        const ulid = createUlid();
        const size = pack.body.size - pack.packOffset;
        const entry = { repositoryId, ulid, size };
        let committed = false;
        // ponytail: a crash between the log's commit point and the billing row leaves the push unbilled; reconcile against the WAL index, as pull refs do, if that leak matters.
        return this.quota
          .reserve(
            storageAccountOf(repository),
            billedKindOf(repository, 'repository'),
            size,
            async (tx) => {
              await this.pushTransaction.commitPush({
                ulid,
                repoId: repositoryId,
                transitions,
                ...pack,
                actor: { userId: pushedBy, verdict },
              });
              committed = true;
              await tx
                .insert(schema.repositoryLogEntry)
                .values(entry)
                .onConflictDoNothing();
            },
          )
          .catch(async (error: unknown) => {
            // The layer is in the log whatever the transaction did, so it is billed outside it for the next push's quota check to count.
            if (committed)
              await this.db
                .insert(schema.repositoryLogEntry)
                .values(entry)
                .onConflictDoNothing();
            throw error;
          });
      },
    );
    return { importing, repoDirectory };
  }

  /** Published after the push, not with it: refs live in object storage, outside any database transaction, so a crash in between loses the event but never invents one. */
  private async publishPushes({
    repositoryId,
    repoDirectory,
    transitions,
    pushedBy,
  }: {
    repositoryId: string;
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
  }: {
    repositoryId: string;
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

/** GitHub's GH013 report: each refused ref, then each rule that refused it, naming the ruleset. */
function ruleViolationLines(violations: Violation[]) {
  return [...new Set(violations.map(({ ref }) => ref))].flatMap((ref) => [
    `error: GH013: Repository rule violations found for ${ref}.`,
    '',
    ...violations
      .filter((violation) => violation.ref === ref)
      .map(
        ({ message, rulesetName }) => `- ${message} (ruleset "${rulesetName}")`,
      ),
    '',
  ]);
}
