import { Inject, Injectable } from '@nestjs/common';
import { isUtf8 } from 'node:buffer';
import { type Database, schema } from '@ghost/db';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { CreateRepositoryRequestDTO } from './dto/create-repository.dto.js';
import { GetRepositoriesQueryDTO } from './dto/get-repositories.dto.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  BlobNotFoundError,
  BranchNotFoundError,
  CannotForkOwnRepositoryError,
  CommitNotFoundError,
  InvalidCursorError,
  RepositoryAlreadyForkedError,
  RepositoryNotFoundError,
} from './repositories.errors.js';
import { decodeCursor, encodeCursor, titleToSlug } from '../../utils/index.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryPathIndexService } from '../../services/git/path-index/repository-path-index.service.js';
import { runGit } from '../../services/git/exec/run-git.js';
import { listTree } from '../../services/git/tree/list-tree.js';
import {
  isSha,
  listCommits,
  readCommit,
  type Commit,
} from '../../services/git/commits/list-commits.js';
import {
  readBlob,
  statBlob,
  streamBlob,
} from '../../services/git/blob/read-blob.js';
import { mediaTypeFor } from '../../services/git/blob/media-type.js';
import {
  normalizeBlobPath,
  normalizeTreePath,
} from '../../services/git/tree/tree-path.js';
import {
  resolveDefaultRef,
  resolveRevision,
} from '../../services/git/tree/resolve-ref.js';
import type { PathCommit } from '../../services/git/path-index/repository-path-index.service.js';
import type {
  CommitSummaryDTO,
  GetRepositoryContentsResponseDTO,
} from './dto/get-repository-contents.dto.js';
import type { GetRepositoryBranchesResponseDTO } from './dto/get-repository-branches.dto.js';
import type { GetRepositoryBlobResponseDTO } from './dto/get-repository-blob.dto.js';
import type {
  CommitDTO,
  GetRepositoryCommitResponseDTO,
  GetRepositoryCommitsQueryDTO,
  GetRepositoryCommitsResponseDTO,
} from './dto/get-repository-commits.dto.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class RepositoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly storage: RepositoryStorageService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly pathIndex: RepositoryPathIndexService,
    private readonly branches: BranchesService,
    private readonly access: RepositoryAccessService,
    private readonly wal: WalStoreService,
  ) {}

  async createRepository(body: CreateRepositoryRequestDTO, userId: string) {
    const user = await this.usersService.getUserById(userId);

    const [newRepo] = await this.db
      .insert(schema.repository)
      .values({
        name: body.name,
        ownerId: user.id,
        slug: await this.freeSlug(user.id, body.name),
        description: body.description,
      })
      .returning();

    return {
      id: newRepo.id,
      slug: newRepo.slug,
    };
  }

  async getRepositories(
    username: string,
    requesterId?: string,
    query: GetRepositoriesQueryDTO = {},
  ) {
    const user = await this.usersService.getUserByUsername(username);
    const includePrivate = user.id === requesterId;

    const requested = Number(query.limit);
    const pageSize = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !decoded) {
      throw new InvalidCursorError();
    }

    // Keyset predicate matching the (lastPushedAt, id) ordering below. `id`
    // breaks ties so repos sharing a lastPushedAt are never skipped or repeated.
    const after = decoded
      ? or(
          lt(schema.repository.lastPushedAt, decoded.date),
          and(
            eq(schema.repository.lastPushedAt, decoded.date),
            lt(schema.repository.id, decoded.id),
          ),
        )
      : undefined;

    const rows = await this.db
      .select()
      .from(schema.repository)
      .where(
        and(
          eq(schema.repository.ownerId, user.id),
          inArray(
            schema.repository.visibility,
            includePrivate ? ['private', 'public'] : ['public'],
          ),
          after,
        ),
      )
      .orderBy(desc(schema.repository.lastPushedAt), desc(schema.repository.id))
      // one extra row tells us whether another page exists
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const repositories = hasMore ? rows.slice(0, pageSize) : rows;
    const last = repositories.at(-1);

    return {
      repositories,
      nextCursor:
        hasMore && last
          ? encodeCursor({ date: last.lastPushedAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async getRepositoryBySlug({
    ownerId,
    slug,
  }: {
    ownerId: string;
    slug: string;
  }) {
    const [repository] = await this.db
      .select()
      .from(schema.repository)
      .where(
        and(
          eq(schema.repository.ownerId, ownerId),
          eq(schema.repository.slug, slug.toLowerCase()),
        ),
      );
    if (!repository) {
      throw new RepositoryNotFoundError();
    }
    return repository;
  }

  async getRepository({
    username,
    slug,
    requesterId,
  }: {
    username: string;
    slug: string;
    requesterId?: string;
  }) {
    const repository = await this.authorizeRead({
      username,
      slug,
      requesterId,
    });
    const [stars, forks, parent] = await Promise.all([
      this.readStars(repository.id, requesterId),

      this.db
        .select({
          forkCount: count(),
          // the viewer's own fork, so the UI can send them there instead of offering another
          viewerForkSlug: requesterId
            ? sql<
                string | null
              >`max(${schema.repository.slug}) filter (where ${schema.repository.ownerId} = ${requesterId})`
            : sql<string | null>`null`,
        })
        .from(schema.repository)
        .where(eq(schema.repository.parentRepositoryId, repository.id)),

      repository.parentRepositoryId
        ? this.db
            .select({
              username: schema.user.username,
              slug: schema.repository.slug,
              name: schema.repository.name,
            })
            .from(schema.repository)
            .innerJoin(
              schema.user,
              eq(schema.user.id, schema.repository.ownerId),
            )
            .where(eq(schema.repository.id, repository.parentRepositoryId))
        : [],
    ]);

    return {
      ...repository,
      ...stars,
      forkCount: forks[0]?.forkCount ?? 0,
      viewerForkSlug: forks[0]?.viewerForkSlug ?? null,
      parent: parent[0]?.username
        ? { ...parent[0], username: parent[0].username }
        : null,
    };
  }

  async forkRepository({
    username,
    slug,
    requesterId,
    name,
    description,
    visibility,
  }: {
    username: string;
    slug: string;
    requesterId: string;
    name: string;
    description?: string;
    visibility: 'public' | 'private';
  }) {
    const parent = await this.authorizeRead({ username, slug, requesterId });
    if (parent.ownerId === requesterId)
      throw new CannotForkOwnRepositoryError();

    const [existing] = await this.db
      .select({ slug: schema.repository.slug })
      .from(schema.repository)
      .where(
        and(
          eq(schema.repository.ownerId, requesterId),
          eq(schema.repository.parentRepositoryId, parent.id),
        ),
      );
    if (existing) throw new RepositoryAlreadyForkedError(existing.slug);

    const owner = await this.usersService.getUserById(requesterId);
    const [fork] = await this.db
      .insert(schema.repository)
      .values({
        name,
        description,
        visibility,
        slug: await this.freeSlug(requesterId, name),
        ownerId: requesterId,
        parentRepositoryId: parent.id,
      })
      .returning();

    await this.wal.copyLog(parent.id, fork.id);

    return { id: fork.id, slug: fork.slug, username: owner.username ?? '' };
  }

  private async freeSlug(ownerId: string, name: string) {
    const { slugified, slugifiedWithSuffix } = titleToSlug(name);
    try {
      await this.getRepositoryBySlug({ ownerId, slug: slugified });
      return slugifiedWithSuffix;
    } catch (_) {
      return slugified;
    }
  }

  /** Stars are a toggle, so a repeat press is a no-op rather than an error. */
  async starRepository({
    username,
    slug,
    requesterId,
  }: {
    username: string;
    slug: string;
    requesterId: string;
  }) {
    const repository = await this.authorizeRead({
      username,
      slug,
      requesterId,
    });

    await this.db
      .insert(schema.stars)
      .values({ userId: requesterId, repositoryId: repository.id })
      .onConflictDoNothing();

    return this.readStars(repository.id, requesterId);
  }

  async unstarRepository({
    username,
    slug,
    requesterId,
  }: {
    username: string;
    slug: string;
    requesterId: string;
  }) {
    const repository = await this.authorizeRead({
      username,
      slug,
      requesterId,
    });

    await this.db
      .delete(schema.stars)
      .where(
        and(
          eq(schema.stars.userId, requesterId),
          eq(schema.stars.repositoryId, repository.id),
        ),
      );

    return this.readStars(repository.id, requesterId);
  }

  private authorizeRead({
    username,
    slug,
    requesterId,
  }: {
    username: string;
    slug: string;
    requesterId?: string;
  }) {
    return this.access.authorize({
      username,
      repo: slug,
      actor: requesterId ? { userId: requesterId } : null,
      operation: 'read',
    });
  }

  private async readStars(repositoryId: string, requesterId?: string) {
    const [row] = await this.db
      .select({
        starCount: count(),
        // bool_or is null over no rows, and an anonymous viewer has starred nothing
        viewerHasStarred: requesterId
          ? sql<boolean>`coalesce(bool_or(${schema.stars.userId} = ${requesterId}), false)`
          : sql<boolean>`false`,
      })
      .from(schema.stars)
      .where(eq(schema.stars.repositoryId, repositoryId));

    return {
      starCount: row?.starCount ?? 0,
      viewerHasStarred: row?.viewerHasStarred ?? false,
    };
  }

  async getRepositoryContents({
    username,
    repo,
    path = '',
    requesterId,
    ref: requestedRef,
  }: {
    username: string;
    repo: string;
    path?: string;
    requesterId?: string;
    ref?: string;
  }): Promise<GetRepositoryContentsResponseDTO> {
    const prefix = normalizeTreePath(path);

    const { repository, directory, ref, detached } = await this.openRepository({
      username,
      repo,
      requesterId,
      ref: requestedRef,
    });

    // a commit is a fixed point in history, so there is no moving tip to index
    if (detached) {
      const [entries, commitCount, commit] = await Promise.all([
        listTree({ gitDir: directory, ref, prefix }),
        this.countCommits({ directory, range: ref }),
        readCommit({ gitDir: directory, sha: ref }),
      ]);

      return {
        ref,
        path: prefix,
        commitCount,
        commit: commit ? toCommitSummaryOf(commit) : null,
        // per-entry history would be one walk per path, which only the index
        // makes cheap; a point-in-time listing does without it
        entries: entries.map((entry) => ({ ...entry, lastCommit: null })),
      };
    }

    const tip = await this.pathIndex.sync({
      repositoryId: repository.id,
      repoDirectory: directory,
      ref,
    });

    // No tip means the ref does not exist yet, i.e. nothing has been pushed.
    if (!tip) {
      return { ref, path: prefix, commitCount: 0, commit: null, entries: [] };
    }

    const [entries, commitCount] = await Promise.all([
      listTree({ gitDir: directory, ref, prefix }),
      this.countCommits({ directory, range: ref }),
    ]);
    const commits = await this.pathIndex.lookup({
      repositoryId: repository.id,
      ref,
      // the root row is the ref's tip, shown above the listing
      paths: ['', ...entries.map((entry) => entry.path)],
    });

    return {
      ref,
      path: prefix,
      commitCount,
      commit: toCommitSummary(commits.get('')),
      entries: entries.map((entry) => ({
        ...entry,
        lastCommit: toCommitSummary(commits.get(entry.path)),
      })),
    };
  }

  async getRepositoryBlob({
    username,
    repo,
    path,
    requesterId,
    ref: requestedRef,
  }: {
    username: string;
    repo: string;
    path: string;
    requesterId?: string;
    ref?: string;
  }): Promise<GetRepositoryBlobResponseDTO> {
    const filePath = normalizeBlobPath(path);

    const { repository, directory, ref, detached } = await this.openRepository({
      username,
      repo,
      requesterId,
      ref: requestedRef,
    });

    const blob = await readBlob({ gitDir: directory, ref, path: filePath });
    if (!blob) throw new BlobNotFoundError(filePath);

    // one file is one history walk, cheap enough to skip the index for
    const lastCommit = detached
      ? (
          await listCommits({
            gitDir: directory,
            ref,
            path: filePath,
            limit: 1,
          })
        ).commits[0]
      : null;

    if (!detached) {
      await this.pathIndex.sync({
        repositoryId: repository.id,
        repoDirectory: directory,
        ref,
      });
    }
    const commits = detached
      ? new Map()
      : await this.pathIndex.lookup({
          repositoryId: repository.id,
          ref,
          paths: [filePath],
        });

    // git's own heuristic: a NUL anywhere means binary
    const text =
      blob.content !== null &&
      !blob.content.includes(0) &&
      isUtf8(blob.content);

    return {
      ref,
      path: filePath,
      oid: blob.oid,
      size: blob.size,
      encoding: text ? 'utf-8' : 'base64',
      content: blob.content?.toString(text ? 'utf8' : 'base64') ?? null,
      commit: lastCommit
        ? toCommitSummaryOf(lastCommit)
        : toCommitSummary(commits.get(filePath)),
    };
  }

  /** The raw bytes of a file, for the browser to render or download. */
  async getRawBlob({
    username,
    repo,
    path,
    requesterId,
    ref: requestedRef,
  }: {
    username: string;
    repo: string;
    path: string;
    requesterId?: string;
    ref?: string;
  }) {
    const filePath = normalizeBlobPath(path);
    const { directory, ref } = await this.openRepository({
      username,
      repo,
      requesterId,
      ref: requestedRef,
    });

    const blob = await statBlob({ gitDir: directory, ref, path: filePath });
    if (!blob) throw new BlobNotFoundError(filePath);

    const filename = filePath.split('/').pop() ?? filePath;

    return {
      ...blob,
      ...mediaTypeFor(filename),
      filename,
      stream: streamBlob({ gitDir: directory, oid: blob.oid }),
    };
  }

  async getRepositoryCommits({
    username,
    repo,
    requesterId,
    query,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query: GetRepositoryCommitsQueryDTO;
  }): Promise<GetRepositoryCommitsResponseDTO> {
    const { directory, ref } = await this.openRepository({
      username,
      repo,
      requesterId,
      ref: query.ref,
    });

    if (query.cursor && !isSha(query.cursor)) {
      throw new InvalidCursorError();
    }

    // an unborn ref has no history to walk, and git would fail on the revision
    const tip = await runGit({
      args: ['rev-parse', '--quiet', '--verify', '--end-of-options', ref],
      gitDir: directory,
    }).catch(() => '');
    if (!tip.trim()) {
      return { ref, from: 0, to: 0, total: 0, commits: [], nextCursor: null };
    }

    const path = query.path
      ? normalizeTreePath(query.path).slice(0, -1)
      : undefined;

    const [{ commits, nextCursor }, total, before] = await Promise.all([
      listCommits({
        gitDir: directory,
        ref,
        path,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        cursor: query.cursor,
      }),
      this.countCommits({ directory, range: ref, path }),
      // commits above the cursor are the pages already behind this one
      query.cursor
        ? this.countCommits({
            directory,
            range: `${query.cursor}..${ref}`,
            path,
          })
        : 0,
    ]);

    return {
      ref,
      from: commits.length ? before + 1 : 0,
      to: before + commits.length,
      total,
      commits: commits.map(toCommitDTO),
      nextCursor,
    };
  }

  async getRepositoryCommit({
    username,
    repo,
    sha,
    requesterId,
  }: {
    username: string;
    repo: string;
    sha: string;
    requesterId?: string;
  }): Promise<GetRepositoryCommitResponseDTO> {
    if (!isSha(sha)) throw new CommitNotFoundError(sha);

    const { directory } = await this.openRepository({
      username,
      repo,
      requesterId,
    });

    const commit = await readCommit({ gitDir: directory, sha });
    if (!commit) throw new CommitNotFoundError(sha);

    return { ...toCommitDTO(commit), files: commit.files };
  }

  /** The commit as a patch file, straight from git. */
  async getCommitPatch({
    username,
    repo,
    sha,
    path,
    requesterId,
  }: {
    username: string;
    repo: string;
    sha: string;
    path?: string;
    requesterId?: string;
  }) {
    if (!isSha(sha)) throw new CommitNotFoundError(sha);

    const { directory } = await this.openRepository({
      username,
      repo,
      requesterId,
    });

    // -1 keeps it to this commit; a merge legitimately produces no patch
    const patch = await runGit({
      args: [
        'format-patch',
        '-1',
        '--stdout',
        '--end-of-options',
        sha,
        ...(path ? ['--', `:(literal)${path}`] : []),
      ],
      gitDir: directory,
    }).catch(() => null);
    if (patch === null) throw new CommitNotFoundError(sha);

    return patch;
  }

  async getRepositoryBranches({
    username,
    repo,
    requesterId,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
  }): Promise<GetRepositoryBranchesResponseDTO> {
    const { directory, ref } = await this.openRepository({
      username,
      repo,
      requesterId,
    });

    const branches = await this.branches.getGitBranches(directory);
    const defaultBranch = ref.replace(/^refs\/heads\//, '');

    return {
      defaultBranch: branches.includes(defaultBranch) ? defaultBranch : null,
      branches,
    };
  }

  private async countCommits({
    directory,
    range,
    path,
  }: {
    directory: string;
    range: string;
    path?: string;
  }) {
    const count = await runGit({
      args: [
        'rev-list',
        '--count',
        '--end-of-options',
        range,
        ...(path ? ['--', path] : []),
      ],
      gitDir: directory,
    });

    return Number(count.trim());
  }

  /**
   * Resolves what the caller asked for to a revision git can be handed. A
   * branch and a commit sha are the same kind of thing to git, so both live at
   * the same URL; `detached` says which one came back, because a sha has no
   * moving tip and so is never worth indexing.
   */
  private async openRepository({
    username,
    repo,
    requesterId,
    ref: requested,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    ref?: string;
  }) {
    const repository = await this.authorizeRead({
      username,
      slug: repo,
      requesterId,
    });

    const directory = await this.storage.getRepoPath(repository.id);
    await this.materializer.materialize(repository.id, directory);

    const name = requested?.trim();
    if (!name) {
      return {
        repository,
        directory,
        detached: false,
        ref: await resolveDefaultRef({
          gitDir: directory,
        }),
      };
    }

    const resolved = await resolveRevision({
      gitDir: directory,
      branches: await this.branches.getGitBranches(directory),
      requested: name,
    });
    if (resolved) return { repository, directory, ...resolved };

    throw new BranchNotFoundError(name);
  }
}

function toCommitDTO(commit: Commit): CommitDTO {
  return { ...commit, committedAt: commit.committedAt.toISOString() };
}

function toCommitSummaryOf(commit: Commit): CommitSummaryDTO {
  return {
    sha: commit.sha,
    message: commit.subject,
    committedAt: commit.committedAt.toISOString(),
  };
}

function toCommitSummary(commit?: PathCommit): CommitSummaryDTO | null {
  if (!commit) return null;
  return {
    sha: commit.commitSha,
    message: commit.subject,
    committedAt: commit.committedAt.toISOString(),
  };
}
