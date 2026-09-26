import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  type GetColumnData,
  inArray,
  lt,
  or,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { listCommits } from '../../lib/git/commits/list-commits.js';
import { CommitVerificationService } from '../../services/gpg/commit-verification.service.js';
import {
  listDiffFiles,
  mergeBase,
  streamDiffPatch,
} from '../../lib/git/diff/diff.js';
import { runGit } from '../../lib/git/exec/run-git.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { commitTree, mergeTree, packRange } from '../../lib/git/merge/merge.js';
import {
  resolveCommit,
  resolveDefaultRef,
} from '../../lib/git/tree/resolve-ref.js';
import {
  closeIssue,
  MAX_CLOSING_COMMITS,
} from '../../lib/issues/close-issue.js';
import { IssueReferencesService } from '../../services/issues/issue-references.service.js';
import { IssuesService } from '../issues/issues.service.js';
import { fileBody } from '../../lib/git/protocol/git-request-body.js';
import {
  type Repository,
  RepositoryAccessService,
  type RepositoryOperation,
} from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { decodeCursor, encodeCursor } from '../../utils/index.js';
import {
  BranchNotFoundError,
  CommitNotFoundError,
  InvalidCursorError,
} from '../repositories/repositories.errors.js';
import {
  CreatePullRequestRequestDTO,
  UpdatePullRequestRequestDTO,
} from './dto/create-pull-request.dto.js';
import { GetPullRequestsQueryDTO } from './dto/pull-request.dto.js';
import {
  NothingToMergeError,
  PullRequestAlreadyOpenError,
  PullRequestConflictError,
  PullRequestHeadDeletedError,
  PullRequestNotFoundError,
  PullRequestNotOpenError,
  SameBranchPullRequestError,
  UnrelatedHistoriesError,
  UnrelatedRepositoriesError,
} from './pull-requests.errors.js';

// Number, title, body and author live on the issue a request is attached to.
const pullRequestColumns = {
  id: schema.pullRequest.id,
  issueId: schema.pullRequest.issueId,
  number: schema.issue.number,
  title: schema.issue.title,
  body: schema.issue.body,
  authorId: schema.issue.authorId,
  state: schema.pullRequest.state,
  baseRepositoryId: schema.pullRequest.baseRepositoryId,
  baseRef: schema.pullRequest.baseRef,
  headRepositoryId: schema.pullRequest.headRepositoryId,
  headRef: schema.pullRequest.headRef,
  headSha: schema.pullRequest.headSha,
  mergeCommitSha: schema.pullRequest.mergeCommitSha,
  createdAt: schema.issue.createdAt,
  updatedAt: schema.issue.updatedAt,
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
    private readonly storage: RepositoryStorageService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly pushTransaction: PushTransactionService,
    private readonly verification: CommitVerificationService,
    private readonly issues: IssuesService,
    private readonly references: IssueReferencesService,
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
    const base = await this.authorize({ username, repo, requesterId });
    const head = await this.resolveHead(base, body.head, requesterId);
    const headRef = body.head.includes(':')
      ? body.head.slice(body.head.indexOf(':') + 1)
      : body.head;

    if (head.id === base.id && headRef === body.base) {
      throw new SameBranchPullRequestError();
    }

    const [baseDirectory, headDirectory] = await Promise.all([
      this.openCache(base),
      this.openCache(head),
    ]);
    const baseSha = await this.resolveBranch(baseDirectory, body.base);
    const headSha = await this.resolveBranch(headDirectory, headRef);

    const alternates = head.id === base.id ? [] : [headDirectory];
    if (
      !(await mergeBase({
        gitDir: baseDirectory,
        alternates,
        a: baseSha,
        b: headSha,
      }))
    ) {
      throw new UnrelatedHistoriesError();
    }

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
        });
      },
    );

    const { pullRequest } = await this.load({
      username,
      repo,
      number: issue.number,
      requesterId,
    });
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
    const base = await this.authorize({ username, repo, requesterId });
    const head = await this.resolveHead(base, headSpec, requesterId);
    const headRef = headSpec.includes(':')
      ? headSpec.slice(headSpec.indexOf(':') + 1)
      : headSpec;

    const [baseDirectory, headDirectory] = await Promise.all([
      this.openCache(base),
      this.openCache(head),
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
    const base = await this.authorize({ username, repo, requesterId });

    const requested = Number(query.limit);
    const pageSize = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !decoded) throw new InvalidCursorError();

    const state = query.state ?? 'open';
    const rows = await this.db
      .select(pullRequestColumns)
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, base.id),
          state === 'all' ? undefined : eq(schema.pullRequest.state, state),
          decoded
            ? or(
                lt(schema.issue.createdAt, decoded.date),
                and(
                  eq(schema.issue.createdAt, decoded.date),
                  lt(schema.pullRequest.id, decoded.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.issue.createdAt), desc(schema.pullRequest.id))
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page.at(-1);

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
      pullRequests: await Promise.all(
        page.map((row) => this.expandPullRequest(row)),
      ),
      total: totals?.total ?? 0,
      nextCursor:
        hasMore && last
          ? encodeCursor({ date: last.createdAt, id: last.id })
          : null,
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

    return {
      ...(await this.expandPullRequest(pullRequest)),
      mergeBase: git.mergeBase,
      commitCount: git.mergeBase
        ? await this.countRange(git, `${git.mergeBase}..${git.headSha}`)
        : 0,
      changedFiles: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      mergeable:
        pullRequest.state === 'open' &&
        git.mergeBase !== null &&
        git.mergeBase !== git.headSha &&
        (await mergeTree({
          gitDir: git.baseDirectory,
          alternates: git.alternates,
          base: git.baseSha,
          head: git.headSha,
        })) !== null,
    };
  }

  async getCommits(
    params: PullRequestRef & { limit?: number; cursor?: string },
  ) {
    const git = await this.open(params);
    if (!git.mergeBase) return { commits: [], total: 0, nextCursor: null };

    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
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
      total: await this.countRange(git, `${git.mergeBase}..${git.headSha}`),
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

  /** The merge commit is built in the base cache and then pushed through `commitPush`, the same commit point a `git push` uses. Nothing about a merge is allowed to reach the base repository by another route. */
  async mergePullRequest(
    params: PullRequestRef & { requesterId: string; title?: string },
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
    if (!git.mergeBase) throw new UnrelatedHistoriesError();
    if (git.mergeBase === git.headSha) throw new NothingToMergeError();

    const tree = await mergeTree({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      base: git.baseSha,
      head: git.headSha,
    });
    if (!tree) throw new PullRequestConflictError();

    const author = await this.users.getUserById(params.requesterId);
    // a fork's branch name is ambiguous on its own, so the merge subject carries the owner exactly as the request was opened with
    const headOwner = await this.users.getUserById(git.head.ownerId);
    const headLabel =
      git.head.id === base.id
        ? pullRequest.headRef
        : `${headOwner.username}:${pullRequest.headRef}`;

    const mergeCommitSha = await commitTree({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      tree,
      parents: [git.baseSha, git.headSha],
      message: `${params.title ?? `Merge pull request #${pullRequest.number} from ${headLabel}`}\n`,
      author: { name: author.name, email: author.email },
    });

    const directory = await mkdtemp(path.join(tmpdir(), 'ghost-merge-'));
    try {
      // ponytail: excludes only the base tip, so objects on the base repository's other branches can be packed again. Exclude every base ref if entry size matters.
      const pack = await packRange({
        gitDir: git.baseDirectory,
        alternates: git.alternates,
        include: mergeCommitSha,
        exclude: [git.baseSha],
        prefix: path.join(directory, 'merge'),
      });

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

      const isDefaultBranch =
        (await resolveDefaultRef({ gitDir: git.baseDirectory })) ===
        `refs/heads/${pullRequest.baseRef}`;
      const { commits } = isDefaultBranch
        ? await listCommits({
            gitDir: git.baseDirectory,
            env: git.env,
            ref: `${git.baseSha}..${git.headSha}`,
            limit: MAX_CLOSING_COMMITS,
          })
        : { commits: [] };

      await this.db.transaction(async (tx) => {
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

        // Only a merge into the default branch closes anything, the same rule GitHub follows.
        if (!isDefaultBranch) return;
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

      await this.db
        .update(schema.repository)
        .set({ lastPushedAt: new Date() })
        .where(eq(schema.repository.id, base.id));

      return { mergeCommitSha, seq };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  /** Resolves the range the request covers. A merged request reads only the base, which has held its commits since the merge, so it outlives its head branch and repository. */
  private async open(params: PullRequestRef) {
    const { pullRequest, base } = await this.load(params);
    if (pullRequest.mergeCommitSha) {
      return this.openMerged(pullRequest, base, pullRequest.mergeCommitSha);
    }
    if (!pullRequest.headRepositoryId) {
      return {
        pullRequest,
        base,
        baseDirectory: await this.openCache(base),
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
    base: Repository,
    mergeCommitSha: string,
  ) {
    const baseDirectory = await this.openCache(base);
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
  private async openLive(
    pullRequest: PullRequest,
    base: Repository,
    headRepositoryId: string,
  ) {
    const [head] = await this.db
      .select()
      .from(schema.repository)
      .where(eq(schema.repository.id, headRepositoryId));

    const [baseDirectory, headDirectory] = await Promise.all([
      this.openCache(base),
      this.openCache(head),
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

    return {
      pullRequest,
      base,
      head,
      baseDirectory,
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

  private async load({
    username,
    repo,
    number,
    requesterId,
    operation,
  }: PullRequestRef) {
    const base = await this.authorize({
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

  private authorize({
    username,
    repo,
    requesterId,
    operation = 'read',
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    operation?: RepositoryOperation;
  }) {
    return this.access.authorize({
      username,
      repo,
      actor: requesterId ? { userId: requesterId } : null,
      operation,
    });
  }

  private async openCache(repository: Repository) {
    const directory = await this.storage.getRepoPath(repository.id);
    await this.materializer.materialize(
      repository.id,
      directory,
      repository.defaultBranch,
    );
    return directory;
  }

  private async resolveBranch(gitDir: string, branch: string) {
    const sha = await runGit({
      args: [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `refs/heads/${branch}`,
      ],
      gitDir,
    }).catch(() => '');

    if (!sha.trim()) throw new BranchNotFoundError(branch);
    return sha.trim();
  }

  private async countRange(
    {
      baseDirectory,
      env,
    }: { baseDirectory: string; env?: Record<string, string> },
    range: string,
  ) {
    const raw = await runGit({
      args: ['rev-list', '--count', '--end-of-options', range],
      gitDir: baseDirectory,
      env,
    });
    return Number(raw.trim()) || 0;
  }

  /** `owner:branch` names a branch on another repository in the same fork network - the base itself, a fork of it, or the repository the base was forked from. Anything else is not a pull request, it is two unrelated repos. */
  private async resolveHead(
    base: Repository,
    head: string,
    requesterId: string,
  ) {
    if (!head.includes(':')) return base;

    const owner = await this.users.getUserByUsername(
      head.slice(0, head.indexOf(':')),
    );
    const candidates = await this.db
      .select()
      .from(schema.repository)
      .where(eq(schema.repository.ownerId, owner.id));

    const related = candidates.find(
      (candidate) =>
        candidate.id === base.id ||
        candidate.parentRepositoryId === base.id ||
        candidate.id === base.parentRepositoryId,
    );
    if (!related) throw new UnrelatedRepositoriesError();

    return this.access.authorize({
      username: owner.username ?? '',
      repo: related.slug,
      actor: { userId: requesterId },
      operation: 'read',
    });
  }

  private async expandPullRequest(pullRequest: PullRequest) {
    const sides = await this.db
      .select({
        repositoryId: schema.repository.id,
        slug: schema.repository.slug,
        username: schema.user.username,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .where(
        inArray(schema.repository.id, [
          pullRequest.baseRepositoryId,
          pullRequest.headRepositoryId ?? pullRequest.baseRepositoryId,
        ]),
      );

    const author = await this.users.getUserById(pullRequest.authorId);
    // A deleted head repository has no row, and reads as null rather than as some other repository.
    const sideOf = (repositoryId: string | null, ref: string) => {
      const row = sides.find((side) => side.repositoryId === repositoryId);
      return { username: row?.username ?? null, slug: row?.slug ?? null, ref };
    };

    return {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body,
      state: pullRequest.state,
      base: sideOf(pullRequest.baseRepositoryId, pullRequest.baseRef),
      head: sideOf(pullRequest.headRepositoryId, pullRequest.headRef),
      headSha: pullRequest.headSha,
      mergeCommitSha: pullRequest.mergeCommitSha,
      authorUsername: author.username ?? '',
      createdAt: pullRequest.createdAt.toISOString(),
      updatedAt: pullRequest.updatedAt.toISOString(),
    };
  }
}

interface CompareParams {
  username: string;
  repo: string;
  requesterId: string;
  base: string;
  head: string;
}

interface PullRequestRef {
  username: string;
  repo: string;
  number: number;
  requesterId?: string;
  operation?: RepositoryOperation;
}
