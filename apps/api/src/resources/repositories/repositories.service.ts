import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { CreateRepositoryRequestDTO } from './dto/create-repository.dto.js';
import { GetRepositoriesQueryDTO } from './dto/get-repositories.dto.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  BranchNotFoundError,
  InvalidCursorError,
  InvalidRepositoryPathError,
  RepositoryNotFoundError,
} from './repositories.errors.js';
import { decodeCursor, encodeCursor, titleToSlug } from '../../utils/index.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryPathIndexService } from '../../services/git/path-index/repository-path-index.service.js';
import { listTree } from '../../services/git/tree/list-tree.js';
import {
  normalizeTreePath,
  UnsafeTreePathError,
} from '../../services/git/tree/tree-path.js';
import { resolveDefaultRef } from '../../services/git/tree/resolve-ref.js';
import type { PathCommit } from '../../services/git/path-index/repository-path-index.service.js';
import type {
  CommitSummaryDTO,
  GetRepositoryContentsResponseDTO,
} from './dto/get-repository-contents.dto.js';
import type { GetRepositoryBranchesResponseDTO } from './dto/get-repository-branches.dto.js';
import { toRepoId } from '../../git/git.constants.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';

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
  ) {}

  async createRepository(body: CreateRepositoryRequestDTO, userId: string) {
    const user = await this.usersService.getUserById(userId);
    const { slugified, slugifiedWithSuffix } = titleToSlug(body.name);
    let slug = slugified;
    try {
      await this.getRepositoryBySlug({ ownerId: user.id, slug: slugified });
      slug = slugifiedWithSuffix;
    } catch (_) {
      slug = slugified;
    }

    const [newRepo] = await this.db
      .insert(schema.repository)
      .values({
        name: body.name,
        ownerId: user.id,
        slug,
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
    return this.getUserRepositories({
      userId: user.id,
      cursor: query.cursor,
      limit: query.limit,
      includePrivate: user.id === requesterId,
    });
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
    const owner = await this.usersService.getUserByUsername(username);
    const repository = await this.getRepositoryBySlug({
      ownerId: owner.id,
      slug,
    });

    if (repository.visibility === 'private' && owner.id !== requesterId) {
      throw new RepositoryNotFoundError();
    }
    return repository;
  }

  async getRepositoryContents({
    username,
    repo,
    path = '',
    requesterId,
    branch,
  }: {
    username: string;
    repo: string;
    path?: string;
    requesterId?: string;
    branch?: string;
  }): Promise<GetRepositoryContentsResponseDTO> {
    // The query DTO rejects a bad path first; this is the guard for every
    // other caller, and the only place the prefix is allowed to come from.
    const prefix = this.toTreePrefix(path);

    const owner = await this.usersService.getUserByUsername(username);
    const repository = await this.getRepositoryBySlug({
      ownerId: owner.id,
      slug: repo,
    });
    if (repository.visibility === 'private' && owner.id !== requesterId) {
      throw new RepositoryNotFoundError();
    }

    const directory = await this.storage.getRepoPath({ username, repo });
    await this.materializer.materialize(toRepoId(username, repo), directory);

    const ref = branch
      ? await this.resolveBranchRef({ directory, branch })
      : await resolveDefaultRef({
          gitDir: directory,
          defaultBranch: repository.defaultBranch,
        });
    const tip = await this.pathIndex.sync({
      repositoryId: repository.id,
      repoDirectory: directory,
      ref,
    });

    // No tip means the ref does not exist yet, i.e. nothing has been pushed.
    if (!tip) return { ref, path: prefix, commit: null, entries: [] };

    const entries = await listTree({ gitDir: directory, ref, prefix });
    const commits = await this.pathIndex.lookup({
      repositoryId: repository.id,
      ref,
      // the root row is the ref's tip, shown above the listing
      paths: ['', ...entries.map((entry) => entry.path)],
    });

    return {
      ref,
      path: prefix,
      commit: toCommitSummary(commits.get('')),
      entries: entries.map((entry) => ({
        ...entry,
        lastCommit: toCommitSummary(commits.get(entry.path)),
      })),
    };
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
    const owner = await this.usersService.getUserByUsername(username);
    const repository = await this.getRepositoryBySlug({
      ownerId: owner.id,
      slug: repo,
    });
    if (repository.visibility === 'private' && owner.id !== requesterId) {
      throw new RepositoryNotFoundError();
    }

    const directory = await this.storage.getRepoPath({ username, repo });
    await this.materializer.materialize(toRepoId(username, repo), directory);

    const ref = await resolveDefaultRef({
      gitDir: directory,
      defaultBranch: repository.defaultBranch,
    });

    const branches = await this.branches.getGitBranches(directory);
    const defaultBranch = ref.replace(/^refs\/heads\//, '');

    return {
      defaultBranch: branches.includes(defaultBranch) ? defaultBranch : null,
      branches,
    };
  }

  /**
   * Only an existing branch may become a ref: the name is re-prefixed rather
   * than trusted, so it can never reach git as an option or another ref
   * namespace.
   */
  private async resolveBranchRef({
    directory,
    branch,
  }: {
    directory: string;
    branch: string;
  }) {
    const name = branch.replace(/^refs\/heads\//, '');
    const branches = await this.branches.getGitBranches(directory);

    if (!branches.includes(name)) {
      throw new BranchNotFoundError(name);
    }

    return `refs/heads/${name}`;
  }

  private toTreePrefix(path: string) {
    try {
      return normalizeTreePath(path);
    } catch (error) {
      if (error instanceof UnsafeTreePathError) {
        throw new InvalidRepositoryPathError(error.reason);
      }
      throw error;
    }
  }

  private async getUserRepositories({
    cursor,
    includePrivate = false,
    limit = DEFAULT_PAGE_SIZE,
    userId,
  }: {
    userId: string;
    cursor?: string;
    limit?: number;
    includePrivate?: boolean;
  }) {
    const requested = Number(limit);
    const pageSize = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
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
          eq(schema.repository.ownerId, userId),
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
}

function toCommitSummary(commit?: PathCommit): CommitSummaryDTO | null {
  if (!commit) return null;
  return {
    sha: commit.commitSha,
    message: commit.subject,
    committedAt: commit.committedAt.toISOString(),
  };
}
