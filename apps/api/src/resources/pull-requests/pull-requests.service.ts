import path from 'node:path';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  type GetColumnData,
  getTableColumns,
  inArray,
  isNull,
  ne,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { publishEvent } from '../../lib/events/events.js';
import {
  countCommits,
  listCommits,
} from '../../lib/git/commits/list-commits.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import {
  listDiffFiles,
  mergeBase,
  streamDiffPatch,
} from '../../lib/git/diff/diff.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import {
  commitTree,
  mergeTree,
  packRange,
  rebaseCommits,
} from '../../lib/git/merge/merge.js';
import {
  resolveCommit,
  resolveDefaultRef,
  toBranchRef,
} from '../../lib/git/tree/resolve-ref.js';
import {
  closeIssue,
  MAX_CLOSING_COMMITS,
} from '../../lib/issues/close-issue.js';
import { IssueReferencesService } from '../../services/issues/issue-references.service.js';
import { IssuesService } from '../issues/issues.service.js';
import { fileBody } from '../../lib/git/protocol/git-request-body.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import {
  ownerNameOf,
  type Repository,
  type RepositoryOperation,
} from '../../lib/repositories/access/repository-access.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { LfsService } from '../../services/git/lfs/lfs.service.js';
import { lfsPointersIn } from '../../lib/git/lfs/lfs-pointer.js';
import { PullRefsService } from '../../services/git/pull-refs/pull-refs.service.js';
import { PullRequestPushesService } from '../../services/pull-requests/pull-request-pushes.service.js';
import {
  commitsAdded,
  recordCommitEvents,
} from '../../lib/pull-requests/commit-events.js';
import { pullHeadRef } from '../../lib/git/refs/pull-refs.js';
import { UsersService } from '../../services/users/users.service.js';
import { StorageQuotaService } from '../../services/storage/storage-quota.service.js';
import {
  storageAccountOf,
  billedKindOf,
} from '../../lib/storage/storage-account.js';
import { encodeCursor, keysetAfter, paginate } from '../../lib/db/keyset.js';
import {
  BranchNotFoundError,
  CommitNotFoundError,
} from '../../lib/repositories/repositories.errors.js';
import {
  CreatePullRequestRequestDTO,
  UpdatePullRequestRequestDTO,
} from './dto/create-pull-request.dto.js';
import { GetPullRequestsQueryDTO } from './dto/pull-request.dto.js';
import type { MergeMethod } from './dto/pull-request-changes.dto.js';
import {
  NothingToMergeError,
  PullRequestAlreadyOpenError,
  PullRequestConflictError,
  PullRequestDraftError,
  PullRequestHeadDeletedError,
  PullRequestNotFoundError,
  PullRequestNotOpenError,
  SameBranchPullRequestError,
  UnrelatedHistoriesError,
  UnrelatedRepositoriesError,
} from '../../lib/pull-requests/pull-requests.errors.js';
import { withTempDir } from '../../lib/temp-dir.js';
import type { AuthorizedRepository } from '../../lib/repositories/access/repository-access.js';
import { canEditThread } from '../../lib/issues/can-edit-thread.js';

// Number, title, body and author live on the issue a request is attached to.
const pullRequestColumns = {
  id: schema.pullRequest.id,
  issueId: schema.pullRequest.issueId,
  number: schema.issue.number,
  title: schema.issue.title,
  body: schema.issue.body,
  authorId: schema.issue.authorId,
  state: schema.pullRequest.state,
  draft: schema.pullRequest.draft,
  baseRepositoryId: schema.pullRequest.baseRepositoryId,
  baseRef: schema.pullRequest.baseRef,
  headRepositoryId: schema.pullRequest.headRepositoryId,
  headRef: schema.pullRequest.headRef,
  headSha: schema.pullRequest.headSha,
  mergeCommitSha: schema.pullRequest.mergeCommitSha,
  pullRefsBlocked: schema.pullRequest.pullRefsBlocked,
  createdAt: schema.issue.createdAt,
  updatedAt: schema.issue.updatedAt,
};

const DEFAULT_PAGE_SIZE = 20;
// ponytail: a squash message lists at most this many of the head's commits; older ones are left out of the body, not the tree.
const MAX_SQUASH_MESSAGES = 250;

type PullRequest = {
  [Key in keyof typeof pullRequestColumns]: GetColumnData<
    (typeof pullRequestColumns)[Key]
  >;
};

@Injectable()
export class PullRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly access: RepositoryAccessService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly pushTransaction: PushTransactionService,
    private readonly verification: CommitVerificationService,
    private readonly signing: CommitSigningService,
    private readonly issues: IssuesService,
    private readonly references: IssueReferencesService,
    private readonly pullRefs: PullRefsService,
    private readonly pullRequestPushes: PullRequestPushesService,
    private readonly quota: StorageQuotaService,
    private readonly lfs: LfsService,
  ) {}

  async createPullRequest({
    username,
    repo,
    requesterId,
    body,
  }: {
    username: string;
    repo: string;
    requesterId: string;
    body: CreatePullRequestRequestDTO;
  }) {
    const {
      base,
      head,
      headRef,
      baseSha,
      to: headSha,
      range,
    } = await this.openComparison({
      username,
      repo,
      requesterId,
      base: body.base,
      head: body.head,
    });
    if (head.id === base.id && headRef === body.base) {
      throw new SameBranchPullRequestError();
    }
    const { gitDir: baseDirectory, alternates } = range;

    const [existing] = await this.db
      .select({ number: schema.issue.number })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, base.id),
          eq(schema.pullRequest.baseRef, body.base),
          eq(schema.pullRequest.headRepositoryId, head.id),
          eq(schema.pullRequest.headRef, headRef),
          eq(schema.pullRequest.state, 'open'),
        ),
      );
    if (existing) throw new PullRequestAlreadyOpenError(existing.number);

    const commits = await commitsAdded({
      gitDir: baseDirectory,
      alternates,
      tip: headSha,
      exclude: [baseSha],
    });

    const issue = await this.issues.open(
      {
        repository: base,
        title: body.title,
        body: body.body ?? null,
        authorId: requesterId,
        isPullRequest: true,
      },
      async (tx, row) => {
        await tx.insert(schema.pullRequest).values({
          issueId: row.id,
          baseRepositoryId: base.id,
          baseRef: body.base,
          headRepositoryId: head.id,
          headRef,
          headSha,
          draft: body.draft ?? false,
        });
        await recordCommitEvents(tx, {
          issueId: row.id,
          actorId: requesterId,
          commits,
        });
      },
    );

    const { pullRequest } = await this.load({
      username,
      repo,
      number: issue.number,
      requesterId,
    });
    this.pullRefs.syncInBackground(pullRequest.id);
    return this.expandPullRequest(pullRequest);
  }

  /** The files a request would carry, before one is opened. */
  async compare(params: CompareParams) {
    const { from, to, range } = await this.openComparison(params);
    return { from, to, files: await listDiffFiles(range) };
  }

  /** One file of that same diff, or all of it when no path is given. */
  async compareStreamPatch(params: CompareParams & { path?: string }) {
    const { range } = await this.openComparison(params);
    return streamDiffPatch({ ...range, path: params.path });
  }

  private async openComparison({
    username,
    repo,
    requesterId,
    base: baseRef,
    head: headSpec,
  }: CompareParams) {
    const base = await this.access.authorize({ username, repo, requesterId });
    const head = await this.resolveHead(base, headSpec, requesterId);
    const headRef = headSpec.includes(':')
      ? headSpec.slice(headSpec.indexOf(':') + 1)
      : headSpec;

    const [baseDirectory, headDirectory] = await Promise.all([
      this.materializer.open(base),
      this.materializer.open(head),
    ]);
    const alternates = head.id === base.id ? [] : [headDirectory];

    const baseSha = await this.resolveBranch(baseDirectory, baseRef);
    const headSha = await this.resolveBranch(headDirectory, headRef);
    const from = await mergeBase({
      gitDir: baseDirectory,
      alternates,
      a: baseSha,
      b: headSha,
    });
    if (!from) throw new UnrelatedHistoriesError();

    return {
      base,
      head,
      headRef,
      baseSha,
      from,
      to: headSha,
      range: { gitDir: baseDirectory, alternates, from, to: headSha },
    };
  }

  async getPullRequests({
    username,
    repo,
    requesterId,
    query,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query: GetPullRequestsQueryDTO;
  }) {
    const base = await this.access.authorize({ username, repo, requesterId });

    const pageSize = query.limit ?? DEFAULT_PAGE_SIZE;

    const state = query.state ?? 'open';
    const rows = await this.db
      .select(pullRequestColumns)
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, base.id),
          state === 'all' ? undefined : eq(schema.pullRequest.state, state),
          keysetAfter(
            query.cursor,
            schema.issue.createdAt,
            schema.pullRequest.id,
          ),
        ),
      )
      .orderBy(desc(schema.issue.createdAt), desc(schema.pullRequest.id))
      .limit(pageSize + 1);

    const { page, hasMore, nextCursor } = paginate(rows, pageSize, (row) =>
      encodeCursor({ date: row.createdAt, id: row.id }),
    );

    const [totals] = await this.db
      .select({ total: count() })
      .from(schema.pullRequest)
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, base.id),
          state === 'all' ? undefined : eq(schema.pullRequest.state, state),
        ),
      );

    return {
      pullRequests: await this.expandPullRequests(page),
      total: totals?.total ?? 0,
      nextCursor,
      hasMore,
    };
  }

  async getPullRequest(params: PullRequestRef) {
    const { pullRequest, ...git } = await this.open(params);
    const files = git.mergeBase
      ? await listDiffFiles({
          gitDir: git.baseDirectory,
          alternates: git.alternates,
          from: git.mergeBase,
          to: git.headSha,
        })
      : [];

    const merge =
      pullRequest.state === 'open' &&
      git.mergeBase !== null &&
      git.mergeBase !== git.headSha
        ? await mergeTree({
            gitDir: git.baseDirectory,
            alternates: git.alternates,
            base: git.baseSha,
            head: git.headSha,
          })
        : null;

    return {
      ...(await this.expandPullRequest(pullRequest)),
      // The stored head is only refreshed on merge; an open request's diff, and whether a line comment is outdated, go by the branch as it stands.
      headSha: git.headSha,
      mergeBase: git.mergeBase,
      commitCount: git.mergeBase
        ? await countCommits({
            gitDir: git.baseDirectory,
            env: git.env,
            range: `${git.mergeBase}..${git.headSha}`,
          })
        : 0,
      changedFiles: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      mergeable: !pullRequest.draft && merge !== null && merge.clean,
      viewerCanEdit: canEditThread(
        pullRequest.authorId,
        params.requesterId,
        git.base.viewerRole,
      ),
      conflicts: merge?.conflicts ?? [],
      pullRefsBlocked: pullRequest.pullRefsBlocked,
      squash: merge ? await this.squashMessage({ ...git, pullRequest }) : null,
      reviewers: await this.reviewers(pullRequest.id),
    };
  }

  /** Each reviewer's latest verdict. A dismissed one leaves that reviewer with none, rather than falling back to an older verdict. */
  private reviewers(pullRequestId: string) {
    const latest = this.db
      .selectDistinctOn([schema.pullRequestReview.authorId], {
        username: sql<string>`coalesce(${schema.user.username}, '')`.as(
          'username',
        ),
        image: schema.user.image,
        state: schema.pullRequestReview.state,
        dismissalMessage: schema.pullRequestReview.dismissalMessage,
      })
      .from(schema.pullRequestReview)
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.pullRequestReview.authorId),
      )
      .where(
        and(
          eq(schema.pullRequestReview.pullRequestId, pullRequestId),
          inArray(schema.pullRequestReview.state, [
            'approved',
            'changes_requested',
          ]),
        ),
      )
      .orderBy(
        schema.pullRequestReview.authorId,
        desc(schema.pullRequestReview.createdAt),
      )
      .as('latest');

    return this.db
      .select({
        username: latest.username,
        image: latest.image,
        state: latest.state,
      })
      .from(latest)
      .where(isNull(latest.dismissalMessage));
  }

  async getCommits(
    params: PullRequestRef & { limit?: number; cursor?: string },
  ) {
    const git = await this.open(params);
    if (!git.mergeBase) return { commits: [], total: 0, nextCursor: null };

    const limit = params.limit ?? DEFAULT_PAGE_SIZE;
    const { commits, nextCursor } = await listCommits({
      gitDir: git.baseDirectory,
      env: git.env,
      ref: `${git.mergeBase}..${params.cursor ?? git.headSha}`,
      limit,
    });

    // A fork's commits live in the other repository's objects, which is why the lending env has to come along for the signatures to be readable.
    const verdicts = await this.verification.verifyCommits({
      gitDir: git.baseDirectory,
      env: git.env,
      commits,
    });

    return {
      commits: commits.map((commit) => ({
        ...commit,
        verification: verdicts.get(commit.sha) ?? null,
      })),
      total: await countCommits({
        gitDir: git.baseDirectory,
        env: git.env,
        range: `${git.mergeBase}..${git.headSha}`,
      }),
      nextCursor,
    };
  }

  async getFiles(params: PullRequestRef) {
    const git = await this.open(params);
    if (!git.mergeBase) {
      return { from: git.baseSha, to: git.headSha, files: [] };
    }

    return {
      from: git.mergeBase,
      to: git.headSha,
      files: await listDiffFiles({
        gitDir: git.baseDirectory,
        alternates: git.alternates,
        from: git.mergeBase,
        to: git.headSha,
      }),
    };
  }

  async streamPatch(params: PullRequestRef & { path?: string }) {
    const git = await this.open(params);
    if (git.headDeleted) throw new PullRequestHeadDeletedError();
    return streamDiffPatch({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      from: git.mergeBase ?? git.baseSha,
      to: git.headSha,
      path: params.path,
    });
  }

  /** The result is built in the base cache and then pushed through `commitPush`, the same commit point a `git push` uses. Nothing about a merge is allowed to reach the base repository by another route. */
  async mergePullRequest(
    params: PullRequestRef & {
      requesterId: string;
      title?: string;
      message?: string;
      method?: MergeMethod;
    },
  ) {
    const { pullRequest, base } = await this.load({
      ...params,
      operation: 'write',
    });
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }
    // An open request always has its head: a repository heading one cannot be deleted.
    const git = await this.openLive(
      pullRequest,
      base,
      pullRequest.headRepositoryId!,
    );
    const { mergeBase } = git;
    if (!mergeBase) throw new UnrelatedHistoriesError();
    if (mergeBase === git.headSha) throw new NothingToMergeError();

    const method = params.method ?? 'merge';
    const merger = await this.users.getUserById(params.requesterId);
    const committer = { name: merger.name, email: merger.email };
    const mergeCommitSha =
      method === 'rebase'
        ? await this.rebase(git, committer)
        : await this.commitMerge(git, {
            squash: method === 'squash',
            title: params.title,
            message: params.message,
            committer,
          });
    // A rebase drops merge commits, so a head made only of them replays to nothing.
    if (mergeCommitSha === git.baseSha) throw new NothingToMergeError();

    return await withTempDir('ghost-merge-', async (directory) => {
      // The pull head ref is in the base log, so whatever it reaches was already written there by the last sync and only the merge itself is new.
      const pulledHead = await resolveCommit(
        git.baseDirectory,
        pullHeadRef(pullRequest.number),
      );
      // ponytail: excludes only the base tip and the pull head, so objects on the base repository's other branches can be packed again. Exclude every base ref if entry size matters.
      const pack = await packRange({
        gitDir: git.baseDirectory,
        alternates: git.alternates,
        // The head rides along even when a squash or rebase leaves it unreachable: a merged request reads its commits and diff from the base alone.
        include: [mergeCommitSha, git.headSha],
        exclude: pulledHead ? [git.baseSha, pulledHead] : [git.baseSha],
        prefix: path.join(directory, 'merge'),
      });

      // A fork's LFS objects stay in the fork, so the merge brings along the ones its commits point at. Bytes go first: a merge that fails afterwards leaves only orphans (0010).
      const lfsObjects =
        git.head.id === base.id
          ? []
          : await this.lfs.missingFrom(
              base.id,
              git.head.id,
              await lfsPointersIn({
                gitDir: git.headDirectory,
                include: [git.headSha],
                exclude: [mergeBase],
              }),
            );
      await this.lfs.copy(lfsObjects, git.head.id, base.id);

      // The row stays locked until the merge is recorded, so the request cannot be closed or turned into a draft between this check and the push. Nothing that can fail after the push belongs in here: a rollback would leave the branch merged and the request open.
      const seq = await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select({
            state: schema.pullRequest.state,
            draft: schema.pullRequest.draft,
          })
          .from(schema.pullRequest)
          .where(eq(schema.pullRequest.id, pullRequest.id))
          .for('update');
        if (locked.draft) throw new PullRequestDraftError();
        if (locked.state !== 'open') {
          throw new PullRequestNotOpenError(locked.state);
        }
        await this.quota.assertRoomToMerge(
          storageAccountOf(base),
          billedKindOf(base, 'repository'),
          tx,
        );
        if (lfsObjects.length > 0) {
          await this.quota.assertRoomToMerge(
            storageAccountOf(base),
            billedKindOf(base, 'lfs'),
            tx,
          );
          await this.lfs.record(tx, lfsObjects, base.id);
        }

        const { seq } = await this.pushTransaction.commitPush({
          repoId: base.id,
          transitions: [
            {
              ref: `refs/heads/${pullRequest.baseRef}`,
              oldOid: Buffer.from(git.baseSha, 'hex'),
              newOid: Buffer.from(mergeCommitSha, 'hex'),
            },
          ],
          body: fileBody(pack.path, pack.size),
          packOffset: 0,
          pushedBy: params.requesterId,
        });

        await tx
          .update(schema.pullRequest)
          .set({
            state: 'merged',
            mergeCommitSha,
            headSha: git.headSha,
            mergedAt: new Date(),
          })
          .where(eq(schema.pullRequest.id, pullRequest.id));
        await closeIssue(tx, {
          issueId: pullRequest.issueId,
          actorId: params.requesterId,
          type: 'merged',
          commitSha: mergeCommitSha,
        });
        return seq;
      });

      // Only a merge into the default branch closes anything, the same rule GitHub follows.
      const isDefaultBranch =
        (await resolveDefaultRef({ gitDir: git.baseDirectory })) ===
        `refs/heads/${pullRequest.baseRef}`;
      if (isDefaultBranch) {
        const { commits } = await listCommits({
          gitDir: git.baseDirectory,
          env: git.env,
          // What landed on the base: the head's own commits, or their squashed or rebased copies.
          ref: `${git.baseSha}..${method === 'merge' ? git.headSha : mergeCommitSha}`,
          limit: MAX_CLOSING_COMMITS,
        });
        await this.db.transaction(async (tx) => {
          await this.references.recordCommits(tx, {
            repository: base,
            actorId: params.requesterId,
            commits,
          });
          await this.references.closeReferenced(tx, {
            sources: [
              { type: 'issue', id: pullRequest.issueId },
              ...commits.map((commit) => ({
                type: 'commit' as const,
                id: commit.sha,
              })),
            ],
            actorId: params.requesterId,
            sourceIssueId: pullRequest.issueId,
          });
        });
      }

      await this.db
        .update(schema.repository)
        .set({ lastPushedAt: new Date() })
        .where(eq(schema.repository.id, base.id));

      // The base moved, so every other request into it needs a new test merge; this one only needs its head pinned to what merged.
      this.pullRefs.syncInBackground(pullRequest.id);
      const transitions = [
        {
          ref: `refs/heads/${pullRequest.baseRef}`,
          oldOid: Buffer.from(git.baseSha, 'hex'),
          newOid: Buffer.from(mergeCommitSha, 'hex'),
        },
      ];
      await this.pullRefs.syncAfterPush({ repositoryId: base.id, transitions });
      // a request from the branch this one merged into just gained its commits
      await this.pullRequestPushes.recordPush({
        repositoryId: base.id,
        transitions,
        pushedBy: params.requesterId,
      });

      return { mergeCommitSha, seq };
    });
  }

  /** A merge commit on top of the base tip, or with `squash` the same tree as a single-parent commit credited to the request's author. */
  private async commitMerge(
    git: LiveComparison,
    {
      squash,
      title,
      message,
      committer,
    }: {
      squash: boolean;
      title?: string;
      message?: string;
      committer: { name: string; email: string };
    },
  ) {
    const { tree, clean, conflicts } = await mergeTree({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      base: git.baseSha,
      head: git.headSha,
    });
    if (!clean) throw new PullRequestConflictError(conflicts);

    const { pullRequest } = git;
    if (squash) {
      const author = await this.users.getUserById(pullRequest.authorId);
      const fallback = await this.squashMessage(git);
      const body = (message ?? fallback.message).trim();
      return commitTree({
        gitDir: git.baseDirectory,
        alternates: git.alternates,
        tree,
        parents: [git.baseSha],
        message: `${title ?? fallback.title}\n${body && `\n${body}\n`}`,
        author: { name: author.name, email: author.email },
        committer,
        sign: this.signing.signer,
      });
    }

    // a fork's branch name is ambiguous on its own, so the merge subject carries the owner exactly as the request was opened with
    const { head } = await this.expandPullRequest(pullRequest);
    const headLabel =
      git.head.id === git.base.id
        ? pullRequest.headRef
        : `${head.username}:${pullRequest.headRef}`;
    return commitTree({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      tree,
      parents: [git.baseSha, git.headSha],
      message: `${title ?? `Merge pull request #${pullRequest.number} from ${headLabel}`}\n`,
      author: committer,
      sign: this.signing.signer,
    });
  }

  /** What a squash commit says unless the merger rewrites it: the request title, then the head's commit messages oldest first. */
  private async squashMessage({
    pullRequest,
    baseDirectory,
    env,
    mergeBase,
    headSha,
  }: {
    pullRequest: PullRequest;
    baseDirectory: string;
    env?: Record<string, string>;
    mergeBase: string | null;
    headSha: string;
  }) {
    const { commits } = await listCommits({
      gitDir: baseDirectory,
      env,
      ref: `${mergeBase}..${headSha}`,
      limit: MAX_SQUASH_MESSAGES,
    });
    return {
      title: `${pullRequest.title} (#${pullRequest.number})`,
      message: commits
        .reverse()
        .map(
          (commit) =>
            `* ${[commit.subject, commit.body].filter(Boolean).join('\n\n')}`,
        )
        .join('\n\n'),
    };
  }

  private async rebase(
    git: LiveComparison,
    committer: { name: string; email: string },
  ) {
    const rebased = await rebaseCommits({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      onto: git.baseSha,
      from: git.mergeBase!,
      to: git.headSha,
      committer,
      sign: this.signing.signer,
    });
    if (!rebased.clean) throw new PullRequestConflictError(rebased.conflicts);
    return rebased.tip;
  }

  /** Title and description only - the branches a request spans never move. */
  async updatePullRequest(
    params: PullRequestRef & {
      requesterId: string;
      body: UpdatePullRequestRequestDTO;
    },
  ) {
    await this.load(params);
    await this.issues.updateIssue(params);
    return this.expandPullRequest((await this.load(params)).pullRequest);
  }

  async closePullRequest(params: PullRequestRef & { requesterId: string }) {
    const { pullRequest } = await this.load(params);
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }

    await this.issues.closeIssue(params);
    return this.expandPullRequest((await this.load(params)).pullRequest);
  }

  /** Marks a request ready for review, or turns it back into a draft. Asking for the state it is already in records nothing. */
  async setDraft(
    params: PullRequestRef & { requesterId: string; draft: boolean },
  ) {
    const { pullRequest, base } = await this.load(params);
    if (pullRequest.authorId !== params.requesterId) {
      await this.access.authorize({ ...params, operation: 'write' });
    }
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }

    // Conditional, so two identical requests record one event and a request merged in the meantime is left alone.
    await this.db.transaction(async (tx) => {
      const changed = await tx
        .update(schema.pullRequest)
        .set({ draft: params.draft })
        .where(
          and(
            eq(schema.pullRequest.id, pullRequest.id),
            eq(schema.pullRequest.state, 'open'),
            ne(schema.pullRequest.draft, params.draft),
          ),
        )
        .returning({ id: schema.pullRequest.id });
      if (changed.length === 0) return;
      await tx.insert(schema.issueEvent).values({
        issueId: pullRequest.issueId,
        actorId: params.requesterId,
        type: params.draft ? 'converted_to_draft' : 'ready_for_review',
      });
      await publishEvent(tx, {
        type: params.draft
          ? 'pull_request.converted_to_draft'
          : 'pull_request.ready_for_review',
        repositoryId: base.id,
        actorId: params.requesterId,
        payload: { issueId: pullRequest.issueId },
      });
    });
    return this.expandPullRequest((await this.load(params)).pullRequest);
  }

  /** Resolves the range the request covers. A merged request reads only the base, which has held its commits since the merge, so it outlives its head branch and repository. */
  async open(params: PullRequestRef) {
    const { pullRequest, base } = await this.load(params);
    if (pullRequest.mergeCommitSha) {
      return this.openMerged(pullRequest, base, pullRequest.mergeCommitSha);
    }
    if (!pullRequest.headRepositoryId) {
      return {
        pullRequest,
        base,
        baseDirectory: await this.materializer.open(base),
        alternates: [],
        env: undefined,
        baseSha: pullRequest.headSha,
        headSha: pullRequest.headSha,
        mergeBase: null,
        headDeleted: true,
      };
    }
    return this.openLive(pullRequest, base, pullRequest.headRepositoryId);
  }

  private async openMerged(
    pullRequest: PullRequest,
    base: AuthorizedRepository,
    mergeCommitSha: string,
  ) {
    const baseDirectory = await this.materializer.open(base);
    const baseSha = await resolveCommit(baseDirectory, `${mergeCommitSha}^1`);
    if (!baseSha) throw new CommitNotFoundError(mergeCommitSha);

    return {
      pullRequest,
      base,
      baseDirectory,
      alternates: [],
      env: undefined,
      baseSha,
      headSha: pullRequest.headSha,
      mergeBase: await mergeBase({
        gitDir: baseDirectory,
        alternates: [],
        a: baseSha,
        b: pullRequest.headSha,
      }),
      headDeleted: false,
    };
  }

  /** Materializes both sides and resolves the branches as they stand now. */
  async openLive(
    pullRequest: PullRequest,
    base: AuthorizedRepository,
    headRepositoryId: string,
  ) {
    const [head] = await this.db
      .select()
      .from(schema.repository)
      .where(eq(schema.repository.id, headRepositoryId));

    const [baseDirectory, headDirectory] = await Promise.all([
      this.materializer.open(base),
      this.materializer.open(head),
    ]);
    const alternates = head.id === base.id ? [] : [headDirectory];

    const baseSha = await this.resolveBranch(
      baseDirectory,
      pullRequest.baseRef,
    );
    const headSha = await this.resolveBranch(
      headDirectory,
      pullRequest.headRef,
    );
    this.pullRefs.reconcileInBackground({
      pullRequestId: pullRequest.id,
      number: pullRequest.number,
      gitDir: baseDirectory,
      baseSha,
      headSha,
    });

    return {
      pullRequest,
      base,
      head,
      baseDirectory,
      headDirectory,
      alternates,
      env: alternates.length
        ? {
            GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(
              headDirectory,
              'objects',
            ),
          }
        : undefined,
      baseSha,
      headSha,
      mergeBase: await mergeBase({
        gitDir: baseDirectory,
        alternates,
        a: baseSha,
        b: headSha,
      }),
      headDeleted: false,
    };
  }

  async load({
    username,
    repo,
    number,
    requesterId,
    operation,
  }: PullRequestRef) {
    const base = await this.access.authorize({
      username,
      repo,
      requesterId,
      operation,
    });
    const [pullRequest] = await this.db
      .select(pullRequestColumns)
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.issue.repositoryId, base.id),
          eq(schema.issue.number, number),
        ),
      );
    if (!pullRequest) throw new PullRequestNotFoundError();

    return { pullRequest, base };
  }

  private async resolveBranch(gitDir: string, branch: string) {
    const sha = await resolveCommit(gitDir, toBranchRef(branch));
    if (!sha) throw new BranchNotFoundError(branch);
    return sha;
  }

  /** `owner:branch` names a branch on another repository in the same fork network - the base itself, a fork of it, or the repository the base was forked from. Anything else is not a pull request, it is two unrelated repos. */
  private async resolveHead(
    base: Repository,
    head: string,
    requesterId: string,
  ) {
    if (!head.includes(':')) return base;

    const owner = head.slice(0, head.indexOf(':'));
    const candidates = await this.db
      .select(getTableColumns(schema.repository))
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(ownerNameOf(schema.user, schema.organization), owner));

    const related = candidates.find(
      (candidate) =>
        candidate.id === base.id ||
        candidate.parentRepositoryId === base.id ||
        candidate.id === base.parentRepositoryId,
    );
    if (!related) throw new UnrelatedRepositoriesError();

    return this.access.authorize({
      username: owner,
      repo: related.slug,
      requesterId,
      operation: 'read',
    });
  }

  private async expandPullRequest(pullRequest: PullRequest) {
    const [expanded] = await this.expandPullRequests([pullRequest]);
    return expanded;
  }

  private async expandPullRequests(pullRequests: PullRequest[]) {
    if (pullRequests.length === 0) return [];
    const repositoryIds = pullRequests.flatMap((pullRequest) =>
      pullRequest.headRepositoryId
        ? [pullRequest.baseRepositoryId, pullRequest.headRepositoryId]
        : [pullRequest.baseRepositoryId],
    );
    const [sides, authors] = await Promise.all([
      this.db
        .select({
          repositoryId: schema.repository.id,
          slug: schema.repository.slug,
          username: ownerNameOf(schema.user, schema.organization),
        })
        .from(schema.repository)
        .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
        .leftJoin(
          schema.organization,
          eq(schema.organization.id, schema.repository.organizationId),
        )
        .where(inArray(schema.repository.id, [...new Set(repositoryIds)])),
      this.db
        .select({
          id: schema.user.id,
          username: schema.user.username,
          image: schema.user.image,
        })
        .from(schema.user)
        .where(
          inArray(schema.user.id, [
            ...new Set(pullRequests.map((pullRequest) => pullRequest.authorId)),
          ]),
        ),
    ]);

    const sideById = new Map(sides.map((side) => [side.repositoryId, side]));
    const authorById = new Map(authors.map((author) => [author.id, author]));
    // A deleted head repository has no row, and reads as null rather than as some other repository.
    const sideOf = (repositoryId: string | null, ref: string) => {
      const row = repositoryId ? sideById.get(repositoryId) : undefined;
      return { username: row?.username ?? null, slug: row?.slug ?? null, ref };
    };

    return pullRequests.map((pullRequest) => {
      const author = authorById.get(pullRequest.authorId);
      return {
        id: pullRequest.id,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        state: pullRequest.state,
        draft: pullRequest.draft,
        base: sideOf(pullRequest.baseRepositoryId, pullRequest.baseRef),
        head: sideOf(pullRequest.headRepositoryId, pullRequest.headRef),
        headSha: pullRequest.headSha,
        mergeCommitSha: pullRequest.mergeCommitSha,
        authorUsername: author?.username ?? '',
        authorImage: author?.image ?? null,
        createdAt: pullRequest.createdAt.toISOString(),
        updatedAt: pullRequest.updatedAt.toISOString(),
      };
    });
  }
}

type LiveComparison = Awaited<ReturnType<PullRequestsService['openLive']>>;

interface CompareParams {
  username: string;
  repo: string;
  requesterId: string;
  base: string;
  head: string;
}

export interface PullRequestRef {
  username: string;
  repo: string;
  number: number;
  requesterId?: string;
  operation?: RepositoryOperation;
}
