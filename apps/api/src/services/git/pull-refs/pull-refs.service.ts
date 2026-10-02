import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { mergeBase } from '../../../lib/git/diff/diff.js';
import { runGit } from '../../../lib/git/exec/run-git.js';
import { packRange, testMergeCommit } from '../../../lib/git/merge/merge.js';
import { fileBody } from '../../../lib/git/protocol/git-request-body.js';
import { pullHeadRef, pullMergeRef } from '../../../lib/git/refs/pull-refs.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { NonFastForwardError } from '../../../lib/git/wal/wal.errors.js';
import {
  type RefTransition,
  ZERO_OID,
} from '../../../lib/git/wal/wal.types.js';
import { RepositoryMaterializerService } from '../materializer/repository-materializer.service.js';
import { RepositoryStorageService } from '../repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../wal/push-transaction.service.js';
import { StorageQuotaService } from '../../storage/storage-quota.service.js';

// Each lost race re-reads the log, so this only runs out when the base is being pushed to faster than a merge-tree.
const MAX_ATTEMPTS = 3;
const BRANCH_PREFIX = 'refs/heads/';

/** Keeps `refs/pull/<n>/head` and `/merge` in the base repository's log (0033). Runs after the push that made them stale, never inside it. */
@Injectable()
export class PullRefsService {
  private readonly logger = new Logger(PullRefsService.name);
  private readonly running = new Map<string, Promise<void>>();
  private readonly stale = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: RepositoryStorageService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly pushTransaction: PushTransactionService,
    private readonly quota: StorageQuotaService,
  ) {}

  /** Every open request whose head or base branch a push just moved. */
  async syncAfterPush({
    repositoryId,
    transitions,
  }: {
    repositoryId: string;
    transitions: RefTransition[];
  }) {
    const branches = transitions
      .map(({ ref }) => ref)
      .filter((ref) => ref.startsWith(BRANCH_PREFIX))
      .map((ref) => ref.slice(BRANCH_PREFIX.length));
    if (branches.length === 0) return;

    const affected = await this.db
      .select({ id: schema.pullRequest.id })
      .from(schema.pullRequest)
      .where(
        and(
          eq(schema.pullRequest.state, 'open'),
          or(
            and(
              eq(schema.pullRequest.headRepositoryId, repositoryId),
              inArray(schema.pullRequest.headRef, branches),
            ),
            and(
              eq(schema.pullRequest.baseRepositoryId, repositoryId),
              inArray(schema.pullRequest.baseRef, branches),
            ),
          ),
        ),
      );
    for (const { id } of affected) this.syncInBackground(id);
  }

  /** Coalesces per request: a sync asked for while one runs becomes a single rerun once it ends, which reads whatever the branches hold by then. */
  syncInBackground(pullRequestId: string) {
    if (this.running.has(pullRequestId)) {
      this.stale.add(pullRequestId);
      return;
    }

    const run = (async () => {
      do {
        this.stale.delete(pullRequestId);
        await this.sync(pullRequestId).catch((error: unknown) =>
          this.logger.warn(
            `Pull request refs for ${pullRequestId} were not updated: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      } while (this.stale.has(pullRequestId));
    })().finally(() => this.running.delete(pullRequestId));
    this.running.set(pullRequestId, run);
  }

  /** Called with the tips a reader just resolved, so a sync lost to a crash is redone on the next read rather than the next push. */
  reconcileInBackground({
    pullRequestId,
    number,
    gitDir,
    baseSha,
    headSha,
  }: {
    pullRequestId: string;
    number: number;
    gitDir: string;
    baseSha: string;
    headSha: string;
  }) {
    if (this.running.has(pullRequestId)) return;
    const mergeRef = pullMergeRef(number);
    // ponytail: a request that conflicts has no merge ref, so every read of it reruns a merge-tree that writes nothing. Remember the conflicting pair if that shows up in profiles.
    runGit({
      // no --end-of-options: without --verify rev-parse echoes it, and these refs are built from a number
      args: [
        'rev-parse',
        pullHeadRef(number),
        `${mergeRef}^1`,
        `${mergeRef}^2`,
      ],
      gitDir,
    })
      .catch(() => '')
      .then((current) => {
        if (current.trim() !== [headSha, baseSha, headSha].join('\n'))
          this.syncInBackground(pullRequestId);
      });
  }

  async sync(pullRequestId: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.write(pullRequestId);
      } catch (error) {
        if (!(error instanceof NonFastForwardError) || attempt === MAX_ATTEMPTS)
          throw error;
      }
    }
  }

  private async write(pullRequestId: string) {
    const [pullRequest] = await this.db
      .select({
        number: schema.issue.number,
        authorId: schema.issue.authorId,
        state: schema.pullRequest.state,
        baseRepositoryId: schema.pullRequest.baseRepositoryId,
        baseRef: schema.pullRequest.baseRef,
        headRepositoryId: schema.pullRequest.headRepositoryId,
        headRef: schema.pullRequest.headRef,
        headSha: schema.pullRequest.headSha,
      })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(eq(schema.pullRequest.id, pullRequestId));
    // A closed request keeps the refs it had; GitHub leaves them where they last pointed too.
    if (!pullRequest || pullRequest.state === 'closed') return;

    const baseDirectory = await this.open(pullRequest.baseRepositoryId);
    const headRef = pullHeadRef(pullRequest.number);
    const mergeRef = pullMergeRef(pullRequest.number);
    const refs = await this.listRefs(baseDirectory);

    const target =
      pullRequest.state === 'merged'
        ? // the merge pushed the head into the base log, and nothing tests a merge that already happened
          {
            alternates: [],
            head: pullRequest.headSha,
            merge: refs.get(mergeRef) ?? null,
          }
        : await this.liveTarget(pullRequest, baseDirectory);
    if (!target) return;

    const transitions = [
      transition(headRef, refs.get(headRef) ?? null, target.head),
      transition(mergeRef, refs.get(mergeRef) ?? null, target.merge),
    ].filter((change) => change !== null);
    if (transitions.length === 0) return;

    const directory = await mkdtemp(path.join(tmpdir(), 'ghost-pull-refs-'));
    try {
      // Everything the base log names is already in it, the old pull refs included, so the entry carries only what the fork added since the last sync.
      const pack = await packRange({
        gitDir: baseDirectory,
        alternates: target.alternates,
        include: [target.head, target.merge].filter((sha) => sha !== null),
        exclude: [...new Set(refs.values())],
        prefix: path.join(directory, 'pull'),
      });
      await this.quota.reservePullRefWrite(
        pullRequest.authorId,
        pack.size,
        async (tx) => {
          await this.pushTransaction.commitPush({
            repoId: pullRequest.baseRepositoryId,
            transitions,
            body: fileBody(pack.path, pack.size),
            packOffset: 0,
          });
          await tx
            .insert(schema.pullRequestRefWrite)
            .values({ pullRequestId, size: pack.size });
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** The branch tips as they stand now. Null when the head branch or repository is gone: the refs keep its last tip rather than lose it. */
  private async liveTarget(
    pullRequest: {
      headRepositoryId: string | null;
      headRef: string;
      baseRepositoryId: string;
      baseRef: string;
    },
    baseDirectory: string,
  ) {
    if (!pullRequest.headRepositoryId) return null;
    const headDirectory =
      pullRequest.headRepositoryId === pullRequest.baseRepositoryId
        ? baseDirectory
        : await this.open(pullRequest.headRepositoryId);
    const head = await resolveCommit(
      headDirectory,
      `${BRANCH_PREFIX}${pullRequest.headRef}`,
    );
    if (!head) return null;

    const alternates = headDirectory === baseDirectory ? [] : [headDirectory];
    const base = await resolveCommit(
      baseDirectory,
      `${BRANCH_PREFIX}${pullRequest.baseRef}`,
    );
    const related =
      base &&
      (await mergeBase({
        gitDir: baseDirectory,
        alternates,
        a: base,
        b: head,
      }));
    return {
      alternates,
      head,
      merge: related
        ? await testMergeCommit({
            gitDir: baseDirectory,
            alternates,
            base,
            head,
          })
        : null,
    };
  }

  private async listRefs(gitDir: string) {
    const raw = await runGit({
      args: ['for-each-ref', '--format=%(refname) %(objectname)'],
      gitDir,
    });
    return new Map(
      raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [ref, oid] = line.split(' ');
          return [ref, oid] as const;
        }),
    );
  }

  private async open(repositoryId: string) {
    const [repository] = await this.db
      .select({ defaultBranch: schema.repository.defaultBranch })
      .from(schema.repository)
      .where(eq(schema.repository.id, repositoryId));
    const directory = await this.storage.getRepoPath(repositoryId);
    await this.materializer.materialize(
      repositoryId,
      directory,
      repository?.defaultBranch ?? null,
    );
    return directory;
  }
}

function transition(
  ref: string,
  current: string | null,
  next: string | null,
): RefTransition | null {
  if (current === next) return null;
  return {
    ref,
    oldOid: current ? Buffer.from(current, 'hex') : ZERO_OID,
    newOid: next ? Buffer.from(next, 'hex') : ZERO_OID,
  };
}
