import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { listCommits } from '../../services/git/commits/list-commits.js';
import {
  listDiffFiles,
  mergeBase,
  streamDiffPatch,
} from '../../services/git/diff/diff.js';
import { runGit } from '../../services/git/exec/run-git.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import {
  commitTree,
  mergeTree,
  packRange,
} from '../../services/git/merge/merge.js';
import { fileBody } from '../../services/git/protocol/git-request-body.js';
import {
  type Repository,
  RepositoryAccessService,
} from '../../services/git/repository-access/repository-access.service.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { decodeCursor, encodeCursor } from '../../utils/index.js';
import {
  BranchNotFoundError,
  InvalidCursorError,
} from '../repositories/repositories.errors.js';
import { CreatePullRequestRequestDTO } from './dto/create-pull-request.dto.js';
import { GetPullRequestsQueryDTO } from './dto/pull-request.dto.js';
import {
  NothingToMergeError,
  PullRequestAlreadyOpenError,
  PullRequestConflictError,
  PullRequestNotFoundError,
  PullRequestNotOpenError,
  SameBranchPullRequestError,
  UnrelatedHistoriesError,
  UnrelatedRepositoriesError,
} from './pull-requests.errors.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type PullRequest = typeof schema.pullRequest.$inferSelect;

@Injectable()
export class PullRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly access: RepositoryAccessService,
    private readonly storage: RepositoryStorageService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly pushTransaction: PushTransactionService,
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
      .select({ number: schema.pullRequest.number })
      .from(schema.pullRequest)
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

    const values = {
      title: body.title,
      body: body.body,
      baseRepositoryId: base.id,
      baseRef: body.base,
      headRepositoryId: head.id,
      headRef,
      headSha,
      authorId: requesterId,
      number: sql<number>`(select coalesce(max(${schema.pullRequest.number}), 0) + 1 from ${schema.pullRequest} where ${schema.pullRequest.baseRepositoryId} = ${base.id})`,
    };

    // Two concurrent opens read the same max; the unique index rejects the
    // loser, whose retry then reads the winner's number.
    const [created] = await this.db
      .insert(schema.pullRequest)
      .values(values)
      .returning()
      .catch((error) => {
        if (!isUniqueViolation(error)) throw error;
        return this.db.insert(schema.pullRequest).values(values).returning();
      });

    return this.toDTO(created);
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
      .select()
      .from(schema.pullRequest)
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, base.id),
          state === 'all' ? undefined : eq(schema.pullRequest.state, state),
          decoded
            ? or(
                lt(schema.pullRequest.createdAt, decoded.date),
                and(
                  eq(schema.pullRequest.createdAt, decoded.date),
                  lt(schema.pullRequest.id, decoded.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.pullRequest.createdAt), desc(schema.pullRequest.id))
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page.at(-1);

    return {
      pullRequests: await Promise.all(page.map((row) => this.toDTO(row))),
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
      ...(await this.toDTO(pullRequest)),
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

    return {
      commits: commits.map((commit) => ({
        ...commit,
        committedAt: commit.committedAt.toISOString(),
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
    return streamDiffPatch({
      gitDir: git.baseDirectory,
      alternates: git.alternates,
      from: git.mergeBase ?? git.baseSha,
      to: git.headSha,
      path: params.path,
    });
  }

  /**
   * The merge commit is built in the base cache and then pushed through
   * `commitPush`, the same commit point a `git push` uses. Nothing about a
   * merge is allowed to reach the base repository by another route.
   */
  async mergePullRequest(
    params: PullRequestRef & { requesterId: string; title?: string },
  ) {
    const { pullRequest, base, ...git } = await this.open({
      ...params,
      operation: 'write',
    });
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }
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
    // a fork's branch name is ambiguous on its own, so the merge subject carries
    // the owner exactly as the request was opened with
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
      // ponytail: excludes only the base tip, so objects on the base repository's
      // other branches can be packed again. Exclude every base ref if entry size matters.
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

      await this.db
        .update(schema.pullRequest)
        .set({
          state: 'merged',
          mergeCommitSha,
          headSha: git.headSha,
          mergedAt: new Date(),
          closedAt: new Date(),
        })
        .where(eq(schema.pullRequest.id, pullRequest.id));

      await this.db
        .update(schema.repository)
        .set({ lastPushedAt: new Date() })
        .where(eq(schema.repository.id, base.id));

      return { mergeCommitSha, seq };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async closePullRequest(params: PullRequestRef) {
    const { pullRequest } = await this.load(params);
    if (pullRequest.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }

    const [closed] = await this.db
      .update(schema.pullRequest)
      .set({ state: 'closed', closedAt: new Date() })
      .where(eq(schema.pullRequest.id, pullRequest.id))
      .returning();

    return this.toDTO(closed);
  }

  /** Materializes both sides and resolves the range the request covers. */
  private async open(params: PullRequestRef) {
    const { pullRequest, base } = await this.load(params);
    const [head] = await this.db
      .select()
      .from(schema.repository)
      .where(eq(schema.repository.id, pullRequest.headRepositoryId));

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
      .select()
      .from(schema.pullRequest)
      .where(
        and(
          eq(schema.pullRequest.baseRepositoryId, base.id),
          eq(schema.pullRequest.number, number),
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
    operation?: 'read' | 'write';
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
    await this.materializer.materialize(repository.id, directory);
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

  /**
   * `owner:branch` names a branch on another repository in the same fork
   * network - the base itself, a fork of it, or the repository the base was
   * forked from. Anything else is not a pull request, it is two unrelated repos.
   */
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

  private async toDTO(pullRequest: PullRequest) {
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
          pullRequest.headRepositoryId,
        ]),
      );

    const author = await this.users.getUserById(pullRequest.authorId);
    const sideOf = (repositoryId: string, ref: string) => {
      const row = sides.find((side) => side.repositoryId === repositoryId);
      return { username: row?.username ?? '', slug: row?.slug ?? '', ref };
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
  operation?: 'read' | 'write';
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
