import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import { CreateRepositoryRequestDTO } from './dto/create-repository.dto.js';
import { GetRepositoriesQueryDTO } from './dto/get-repositories.dto.js';
import { UpdateRepositoryRequestDTO } from './dto/update-repository.dto.js';
import { UsersService } from '../../services/users/users.service.js';
import {
  BlobNotFoundError,
  BranchNotFoundError,
  CannotForkOwnRepositoryError,
  CommitNotFoundError,
  InvalidCursorError,
  RepositoryAlreadyForkedError,
  RepositoryHeadsOpenPullRequestError,
  RepositoryNameTakenError,
  TransferNotFoundError,
  TransferTargetError,
} from './repositories.errors.js';
import { closeIssue } from '../../lib/issues/close-issue.js';
import { ownerQualifier } from '../../lib/search/qualifiers.js';
import { organizationToCreateIn } from '../../lib/organizations/administered-organization.js';
import { PrivateForkingDisabledError } from '../../lib/organizations/organization.errors.js';
import {
  decodeCursor,
  encodeCursor,
  escapeLike,
  isoTimestamp,
  titleToSlug,
} from '../../utils/index.js';
import { RepositoryStorageService } from '../../services/git/repository-storage/repository-storage.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryPathIndexService } from '../../services/git/path-index/repository-path-index.service.js';
import { RepositoryLanguageService } from '../../services/git/languages/repository-language.service.js';
import { runGit } from '../../lib/git/exec/run-git.js';
import {
  type CommitVerification,
  CommitVerificationService,
} from '../../services/gpg/commit-verification.service.js';
import { listTree } from '../../lib/git/tree/list-tree.js';
import {
  isSha,
  listCommits,
  readCommit,
  readCommitSummary,
} from '../../lib/git/commits/list-commits.js';
import {
  isTextBlob,
  readBlob,
  statBlob,
  streamBlob,
} from '../../lib/git/blob/read-blob.js';
import { findReadmePath } from '../../lib/git/blob/find-readme.js';
import { mediaTypeFor } from '../../lib/git/blob/media-type.js';
import {
  normalizeBlobPath,
  normalizeTreePath,
} from '../../lib/git/tree/tree-path.js';
import {
  resolveDefaultRef,
  resolveRevision,
} from '../../lib/git/tree/resolve-ref.js';
import type { PathCommit } from '../../services/git/path-index/repository-path-index.service.js';
import type {
  CommitSummaryDTO,
  GetRepositoryContentsResponseDTO,
} from './dto/get-repository-contents.dto.js';
import type { GetRepositoryBranchesResponseDTO } from './dto/get-repository-branches.dto.js';
import type { GetRepositoryLanguagesResponseDTO } from './dto/get-repository-languages.dto.js';
import type {
  GetRepositoryForksQueryDTO,
  GetRepositoryForksResponseDTO,
} from './dto/get-repository-forks.dto.js';
import type {
  GetRepositoryContributorsQueryDTO,
  GetRepositoryContributorsResponseDTO,
} from './dto/get-repository-contributors.dto.js';
import type {
  GetRepositoryStargazersQueryDTO,
  GetRepositoryStargazersResponseDTO,
} from './dto/get-repository-stargazers.dto.js';
import type { GetRepositoryBlobResponseDTO } from './dto/get-repository-blob.dto.js';
import type { GetRepositoryReadmeResponseDTO } from './dto/get-repository-readme.dto.js';
import type {
  CommitDTO,
  GetRepositoryCommitResponseDTO,
  GetRepositoryCommitsQueryDTO,
  GetRepositoryCommitsResponseDTO,
} from './dto/get-repository-commits.dto.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryContributionService } from '../../services/git/contributions/repository-contribution.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import {
  acceptedCollaboration,
  type Actor,
  basePermissionOf,
  grantedTo,
  organizationMembership,
  ownerNameOf,
  readableBy,
  type Repository,
  type RepositoryOperation,
  roleOf,
  teamRoleOf,
} from '../../lib/git/repository-access/repository-access.js';
import { administers, atLeast, organizationRoleOf } from '@ghost/permissions';
import { RepositoryForbiddenError } from '../../lib/git/repository-access/repository-access.errors.js';
import { WalStoreService } from '../../services/git/wal/wal-store.service.js';
import { CodeSearchService } from '../../services/git/code-search/code-search.service.js';
import type {
  SearchCodeResponseDTO,
  SearchRepositoryCodeResponseDTO,
} from './dto/search-code.dto.js';
import type { SearchRepositoriesResponseDTO } from './dto/search-repositories.dto.js';
import type { GetViewerRepositoriesResponseDTO } from './dto/get-viewer-repositories.dto.js';

// `/owner/settings` and `/org/teams` are pages of the owner's own, so no repository may live there.
const RESERVED_REPOSITORY_SLUGS = new Set(['settings', 'teams']);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MIN_LANGUAGE_PERCENT = 0.5;
const DEFAULT_SEARCH_LIMIT = 50;

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly storage: RepositoryStorageService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly pathIndex: RepositoryPathIndexService,
    private readonly languages: RepositoryLanguageService,
    private readonly branches: BranchesService,
    private readonly access: RepositoryAccessService,
    private readonly wal: WalStoreService,
    private readonly contributions: RepositoryContributionService,
    private readonly verification: CommitVerificationService,
    private readonly codeSearch: CodeSearchService,
  ) {}

  async createRepository(body: CreateRepositoryRequestDTO, userId: string) {
    const visibility = body.visibility ?? 'private';
    const organization = body.organization
      ? await organizationToCreateIn(
          this.db,
          body.organization,
          userId,
          visibility,
        )
      : null;
    const namespace: Namespace = organization ?? { userId };

    const [newRepo] = await this.db
      .insert(schema.repository)
      .values({
        name: body.name,
        // The creator, even of an organization's repository, which the organization owns.
        ownerId: userId,
        organizationId: organizationIdOf(namespace),
        slug: await this.freeSlug(namespace, body.name),
        description: body.description,
        visibility,
        defaultBranch: organization?.settings?.defaultBranch ?? null,
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
    const namespace = await this.namespaceNamed(username);

    const { pageSize, after } = this.page(
      query,
      schema.repository.lastPushedAt,
      schema.repository.id,
    );

    const rows = await this.db
      .select(getTableColumns(schema.repository))
      .from(schema.repository)
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actorOf(requesterId)),
      )
      .leftJoin(
        schema.member,
        organizationMembership(
          schema.repository.organizationId,
          actorOf(requesterId),
        ),
      )
      .where(
        and(
          inNamespace(namespace),
          readableBy(actorOf(requesterId)),
          matching(query.q),
          after,
        ),
      )
      .orderBy(desc(schema.repository.lastPushedAt), desc(schema.repository.id))
      .limit(pageSize + 1);

    const { page, nextCursor, hasMore } = paginate(rows, pageSize, (row) => ({
      date: row.lastPushedAt,
      id: row.id,
    }));

    return { repositories: page, nextCursor, hasMore };
  }

  /** Repositories the requester owns, collaborates on, or can reach through an organization, most recently pushed first. */
  async getViewerRepositories(
    requesterId: string,
    query: GetRepositoriesQueryDTO,
  ): Promise<GetViewerRepositoriesResponseDTO> {
    const search = ownerQualifier(query.q ?? '');
    const { pageSize, after } = this.page(
      query,
      schema.repository.lastPushedAt,
      schema.repository.id,
    );

    const rows = await this.db
      .select({
        id: schema.repository.id,
        owner: ownerNameOf(schema.user, schema.organization),
        name: schema.repository.name,
        slug: schema.repository.slug,
        description: schema.repository.description,
        visibility: schema.repository.visibility,
        lastPushedAt: schema.repository.lastPushedAt,
        ownerId: schema.repository.ownerId,
        organizationId: schema.repository.organizationId,
        collaboratorRole: schema.repositoryCollaborator.role,
        memberRole: schema.member.role,
        teamRole: teamRoleOf(schema.repository.id, actorOf(requesterId)),
        basePermission: basePermissionOf(schema.repository.organizationId),
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actorOf(requesterId)),
      )
      .leftJoin(
        schema.member,
        organizationMembership(
          schema.repository.organizationId,
          actorOf(requesterId),
        ),
      )
      .where(
        and(
          grantedTo(actorOf(requesterId)),
          isNotNull(ownerNameOf(schema.user, schema.organization)),
          matching(search.rest),
          search.owner
            ? eq(ownerNameOf(schema.user, schema.organization), search.owner)
            : undefined,
          after,
        ),
      )
      .orderBy(desc(schema.repository.lastPushedAt), desc(schema.repository.id))
      .limit(pageSize + 1);

    const { page, nextCursor, hasMore } = paginate(rows, pageSize, (row) => ({
      date: row.lastPushedAt,
      id: row.id,
    }));

    return {
      repositories: page.map(
        ({
          ownerId,
          organizationId,
          collaboratorRole,
          memberRole,
          teamRole,
          basePermission,
          ...row
        }) => ({
          ...row,
          // Every row passed the filter above, so the requester holds some role on it.
          viewerRole: roleOf(
            { ownerId, organizationId },
            { collaboratorRole, memberRole, teamRole, basePermission },
            actorOf(requesterId),
          )!,
        }),
      ),
      nextCursor,
      hasMore,
    };
  }

  /** Public repositories across every owner, most recently pushed first. */
  async searchRepositories(
    query: GetRepositoriesQueryDTO,
  ): Promise<SearchRepositoriesResponseDTO> {
    const search = ownerQualifier(query.q ?? '');
    const { pageSize, after } = this.page(
      query,
      schema.repository.lastPushedAt,
      schema.repository.id,
    );

    const rows = await this.db
      .select({
        id: schema.repository.id,
        owner: ownerNameOf(schema.user, schema.organization),
        name: schema.repository.name,
        slug: schema.repository.slug,
        description: schema.repository.description,
        lastPushedAt: schema.repository.lastPushedAt,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(
        and(
          eq(schema.repository.visibility, 'public'),
          // an owner without a username has no page to link the repository under
          isNotNull(ownerNameOf(schema.user, schema.organization)),
          matching(search.rest),
          search.owner
            ? eq(ownerNameOf(schema.user, schema.organization), search.owner)
            : undefined,
          after,
        ),
      )
      .orderBy(desc(schema.repository.lastPushedAt), desc(schema.repository.id))
      .limit(pageSize + 1);

    const { page, nextCursor, hasMore } = paginate(rows, pageSize, (row) => ({
      date: row.lastPushedAt,
      id: row.id,
    }));

    return { repositories: page, nextCursor, hasMore };
  }

  /** Code in public repositories, limited to those opened or pushed to since code search was switched on. */
  async searchCode({
    query,
    limit = DEFAULT_SEARCH_LIMIT,
  }: {
    query: string;
    limit?: number;
  }): Promise<SearchCodeResponseDTO> {
    const { owner, rest } = ownerQualifier(query);
    if (!rest) return { files: [] };
    // `org:` names public repositories to scan; one that owns none matches nothing.
    const scoped = owner
      ? await this.db
          .select({ id: schema.repository.id })
          .from(schema.repository)
          .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
          .leftJoin(
            schema.organization,
            eq(schema.organization.id, schema.repository.organizationId),
          )
          .where(
            and(
              eq(ownerNameOf(schema.user, schema.organization), owner),
              eq(schema.repository.visibility, 'public'),
            ),
          )
      : null;
    if (scoped?.length === 0) return { files: [] };

    const hits = await this.codeSearch.searchPublic({
      query: rest,
      limit,
      repositoryIds: scoped?.map((row) => row.id),
    });
    const ids = [...new Set(hits.map((hit) => hit.repositoryId))];
    if (ids.length === 0) return { files: [] };

    // The index only narrows to shards flagged public; the database is what decides.
    const repositories = await this.db
      .select({
        id: schema.repository.id,
        owner: ownerNameOf(schema.user, schema.organization),
        name: schema.repository.name,
        slug: schema.repository.slug,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(
        and(
          inArray(schema.repository.id, ids),
          eq(schema.repository.visibility, 'public'),
          isNotNull(ownerNameOf(schema.user, schema.organization)),
        ),
      );
    const byId = new Map(repositories.map((row) => [row.id, row]));

    return {
      files: hits.flatMap((hit) => {
        const repository = byId.get(hit.repositoryId);
        return repository ? [{ ...hit, repository }] : [];
      }),
    };
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
              username: ownerNameOf(schema.user, schema.organization),
              slug: schema.repository.slug,
              name: schema.repository.name,
            })
            .from(schema.repository)
            .innerJoin(
              schema.user,
              eq(schema.user.id, schema.repository.ownerId),
            )
            .leftJoin(
              schema.organization,
              eq(schema.organization.id, schema.repository.organizationId),
            )
            .where(eq(schema.repository.id, repository.parentRepositoryId))
        : [],
    ]);

    return {
      ...repository,
      // Where it lives now, which differs from the requested name after a rename or transfer.
      owner: await this.ownerNameOf(repository.id),
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
    organization,
  }: {
    username: string;
    slug: string;
    requesterId: string;
    name: string;
    description?: string;
    visibility: 'public' | 'private';
    organization?: string;
  }) {
    const parent = await this.authorizeRead({ username, slug, requesterId });
    if (parent.organizationId && parent.visibility === 'private') {
      const [policy] = await this.db
        .select({ allowed: schema.organizationSettings.allowPrivateForks })
        .from(schema.organizationSettings)
        .where(
          eq(schema.organizationSettings.organizationId, parent.organizationId),
        );
      if (!policy?.allowed) throw new PrivateForkingDisabledError();
    }
    const namespace: Namespace = organization
      ? await organizationToCreateIn(
          this.db,
          organization,
          requesterId,
          visibility,
        )
      : { userId: requesterId };
    if (sameNamespace(namespaceOf(parent), namespace))
      throw new CannotForkOwnRepositoryError();

    // One fork per namespace, so a second press sends the forker to the one they have.
    const [existing] = await this.db
      .select({ slug: schema.repository.slug })
      .from(schema.repository)
      .where(
        and(
          inNamespace(namespace),
          eq(schema.repository.parentRepositoryId, parent.id),
        ),
      );
    if (existing) throw new RepositoryAlreadyForkedError(existing.slug);

    const [fork] = await this.db
      .insert(schema.repository)
      .values({
        name,
        description,
        visibility,
        slug: await this.freeSlug(namespace, name),
        ownerId: requesterId,
        organizationId: organizationIdOf(namespace),
        parentRepositoryId: parent.id,
      })
      .returning();

    await this.wal.copyLog(parent.id, fork.id);

    return {
      id: fork.id,
      slug: fork.slug,
      username:
        organization ??
        (await this.usersService.getUserById(requesterId)).username ??
        '',
    };
  }

  /** Moves a repository, which only its owner may: the user who owns it, or an owner of its organization. A move to the requester's own account or to an organization they administer happens at once; any other recipient accepts it first. */
  async transferRepository({
    username,
    slug,
    requesterId,
    owner,
  }: {
    username: string;
    slug: string;
    requesterId: string;
    owner: string;
  }) {
    const repository = await this.authorizeAs('admin', {
      username,
      slug,
      requesterId,
    });
    if (!atLeast(repository.viewerRole, 'owner')) {
      throw new RepositoryForbiddenError();
    }

    const target = await this.namespaceNamed(owner);
    if (sameNamespace(namespaceOf(repository), target)) {
      throw new TransferTargetError();
    }
    await this.assertSlugFree(target, owner, repository.slug);

    if (await this.holds(target, requesterId)) {
      await this.move(repository, target);
      return {
        id: repository.id,
        slug: repository.slug,
        username: owner,
        pending: false,
      };
    }

    await this.db
      .insert(schema.repositoryTransfer)
      .values({
        repositoryId: repository.id,
        toUserId: 'userId' in target ? target.userId : null,
        toOrganizationId: organizationIdOf(target),
        requestedById: requesterId,
      })
      .onConflictDoUpdate({
        target: schema.repositoryTransfer.repositoryId,
        set: {
          toUserId: 'userId' in target ? target.userId : null,
          toOrganizationId: organizationIdOf(target),
          requestedById: requesterId,
          createdAt: new Date(),
        },
      });
    return {
      id: repository.id,
      slug: repository.slug,
      username: await this.ownerNameOf(repository.id),
      pending: true,
    };
  }

  /** Transfers waiting for the requester: to their own account, or to an organization they administer. */
  async listIncomingTransfers(requesterId: string) {
    const destination = alias(schema.organization, 'destination');
    const requester = alias(schema.user, 'requester');
    const recipient = alias(schema.user, 'recipient');
    const transfers = await this.db
      .select({
        repositoryId: schema.repository.id,
        repository: {
          owner: ownerNameOf(schema.user, schema.organization),
          slug: schema.repository.slug,
          name: schema.repository.name,
        },
        to: ownerNameOf(recipient, destination),
        requestedByUsername: requester.username,
        createdAt: isoTimestamp(schema.repositoryTransfer.createdAt),
      })
      .from(schema.repositoryTransfer)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.repositoryTransfer.repositoryId),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .leftJoin(
        destination,
        eq(destination.id, schema.repositoryTransfer.toOrganizationId),
      )
      .leftJoin(
        requester,
        eq(requester.id, schema.repositoryTransfer.requestedById),
      )
      .leftJoin(recipient, eq(recipient.id, schema.repositoryTransfer.toUserId))
      .leftJoin(
        schema.member,
        and(
          eq(
            schema.member.organizationId,
            schema.repositoryTransfer.toOrganizationId,
          ),
          eq(schema.member.userId, requesterId),
        ),
      )
      .where(
        or(
          eq(schema.repositoryTransfer.toUserId, requesterId),
          inArray(schema.member.role, ['owner', 'admin']),
        ),
      )
      .orderBy(asc(schema.repositoryTransfer.createdAt));

    return { transfers };
  }

  async acceptTransfer(repositoryId: string, requesterId: string) {
    const transfer = await this.incomingTransfer(repositoryId, requesterId);
    const [repository] = await this.db
      .select()
      .from(schema.repository)
      .where(eq(schema.repository.id, repositoryId));
    const target: Namespace = transfer.toOrganizationId
      ? { organizationId: transfer.toOrganizationId }
      : { userId: requesterId };
    await this.assertSlugFree(
      target,
      await this.namespaceName(target),
      repository.slug,
    );
    await this.move(repository, target);
    return {
      id: repository.id,
      slug: repository.slug,
      username: await this.ownerNameOf(repository.id),
    };
  }

  /** The recipient declines, or whoever asked for it withdraws it. */
  async cancelTransfer(repositoryId: string, requesterId: string) {
    const [transfer] = await this.db
      .select()
      .from(schema.repositoryTransfer)
      .where(eq(schema.repositoryTransfer.repositoryId, repositoryId));
    if (!transfer) throw new TransferNotFoundError();
    if (transfer.requestedById !== requesterId) {
      await this.incomingTransfer(repositoryId, requesterId);
    }
    await this.db
      .delete(schema.repositoryTransfer)
      .where(eq(schema.repositoryTransfer.repositoryId, repositoryId));
  }

  /** A pending transfer addressed to the requester, or to an organization they administer. */
  private async incomingTransfer(repositoryId: string, requesterId: string) {
    const [transfer] = await this.db
      .select()
      .from(schema.repositoryTransfer)
      .where(eq(schema.repositoryTransfer.repositoryId, repositoryId));
    if (!transfer) throw new TransferNotFoundError();
    const recipient = transfer.toOrganizationId
      ? await this.holds(
          { organizationId: transfer.toOrganizationId },
          requesterId,
        )
      : transfer.toUserId === requesterId;
    if (!recipient) throw new TransferNotFoundError();
    return transfer;
  }

  /** Whether the requester may put a repository in `namespace` without anyone else agreeing: it is theirs, or an organization they administer. */
  private async holds(namespace: Namespace, requesterId: string) {
    if ('userId' in namespace) return namespace.userId === requesterId;
    const [membership] = await this.db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, namespace.organizationId),
          eq(schema.member.userId, requesterId),
        ),
      );
    return administers(organizationRoleOf(membership?.role));
  }

  private async assertSlugFree(
    namespace: Namespace,
    owner: string,
    slug: string,
  ) {
    const [clash] = await this.db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(and(inNamespace(namespace), eq(schema.repository.slug, slug)));
    if (clash) throw new RepositoryNameTakenError(owner, slug);
  }

  /** Puts the repository in `namespace`, leaving a redirect at its old name and settling any pending transfer. */
  private async move(repository: Repository, namespace: Namespace) {
    const previous = await this.ownerNameOf(repository.id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.repository)
        .set({
          ownerId:
            'userId' in namespace ? namespace.userId : repository.ownerId,
          organizationId: organizationIdOf(namespace),
        })
        .where(eq(schema.repository.id, repository.id));
      // The new owner holds everything already; a collaborator row would only linger.
      if ('userId' in namespace) {
        await tx
          .delete(schema.repositoryCollaborator)
          .where(
            and(
              eq(schema.repositoryCollaborator.repositoryId, repository.id),
              eq(schema.repositoryCollaborator.userId, namespace.userId),
            ),
          );
      }
      await tx
        .delete(schema.repositoryTransfer)
        .where(eq(schema.repositoryTransfer.repositoryId, repository.id));
      await this.leaveRedirect(tx, previous, repository.slug, repository.id);
    });
  }

  /** The newest move wins an old name: a redirect left there by another repository is replaced. */
  private async leaveRedirect(
    tx: Pick<Database, 'insert' | 'delete'>,
    ownerName: string,
    slug: string,
    repositoryId: string,
  ) {
    await tx
      .delete(schema.repositoryRedirect)
      .where(
        and(
          eq(
            sql`lower(${schema.repositoryRedirect.ownerName})`,
            ownerName.toLowerCase(),
          ),
          eq(schema.repositoryRedirect.slug, slug),
        ),
      );
    await tx
      .insert(schema.repositoryRedirect)
      .values({ ownerName, slug, repositoryId });
  }

  private async ownerNameOf(repositoryId: string) {
    const [row] = await this.db
      .select({ owner: ownerNameOf(schema.user, schema.organization) })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, repositoryId));
    return row?.owner ?? '';
  }

  private async namespaceName(namespace: Namespace) {
    if ('userId' in namespace) {
      return (
        (await this.usersService.getUserById(namespace.userId)).username ?? ''
      );
    }
    const [organization] = await this.db
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, namespace.organizationId));
    return organization?.slug ?? '';
  }

  async updateRepository({
    username,
    slug,
    requesterId,
    changes: { name, description, visibility, defaultBranch },
  }: {
    username: string;
    slug: string;
    requesterId: string;
    changes: UpdateRepositoryRequestDTO;
  }) {
    const repository = await this.authorizeAs('maintain', {
      username,
      slug,
      requesterId,
    });
    // Visibility decides who can see the code at all, which is an admin's call.
    if (
      visibility !== undefined &&
      visibility !== repository.visibility &&
      !atLeast(repository.viewerRole, 'admin')
    ) {
      throw new RepositoryForbiddenError();
    }

    if (defaultBranch !== undefined) {
      const stored = await this.wal.readIndex(repository.id);
      if (!stored?.index.refs.has(`refs/heads/${defaultBranch}`))
        throw new BranchNotFoundError(defaultBranch);
    }

    const [updated] = await this.db
      .update(schema.repository)
      .set({
        name,
        description,
        visibility,
        defaultBranch,
        // A form resends the name on every save; recomputing it could hand a suffixed slug a new suffix.
        slug:
          name === undefined || name === repository.name
            ? undefined
            : await this.freeSlug(namespaceOf(repository), name, repository.id),
      })
      .where(eq(schema.repository.id, repository.id))
      .returning();
    if (updated.slug !== repository.slug) {
      await this.leaveRedirect(
        this.db,
        await this.ownerNameOf(repository.id),
        repository.slug,
        repository.id,
      );
    }

    // The shards carry the public flag, so public search follows the change now rather than on the next push or page view.
    if (visibility !== undefined && visibility !== repository.visibility) {
      this.reindexCodeSearch(updated).catch((error: unknown) =>
        this.logger.warn(
          `Reindexing ${updated.id} for visibility failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    return { id: updated.id, slug: updated.slug };
  }

  private async reindexCodeSearch(repository: Repository) {
    const directory = await this.storage.getRepoPath(repository.id);
    await this.materializer.materialize(
      repository.id,
      directory,
      repository.defaultBranch,
    );
    await this.codeSearch.index({
      repositoryId: repository.id,
      isPublic: repository.visibility === 'public',
      repoDirectory: directory,
    });
  }

  /** Nothing of the repository outlives a successful call. A failure leaves it tombstoned, unreadable and still listed, so the owner can retry; see docs/0020. */
  async deleteRepository({
    username,
    slug,
    requesterId,
  }: {
    username: string;
    slug: string;
    requesterId: string;
  }) {
    const repository = await this.authorizeAs('admin', {
      username,
      slug,
      requesterId,
    });

    const [heading] = await this.db
      .select({
        owner: ownerNameOf(schema.user, schema.organization),
        slug: schema.repository.slug,
        number: schema.issue.number,
      })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.pullRequest.baseRepositoryId),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(this.openRequestsHeadedBy(repository.id))
      .limit(1);
    if (heading) {
      throw new RepositoryHeadsOpenPullRequestError(
        `${heading.owner}/${heading.slug}#${heading.number}`,
      );
    }

    await this.wal.tombstone(repository.id);
    await Promise.all([
      this.wal.purgeEntries(repository.id),
      this.materializer
        .settle(repository.id)
        .then(() => this.storage.remove(repository.id)),
      this.codeSearch.remove(repository.id),
    ]);

    await this.db.transaction(async (tx) => {
      // A request opened between the check above and the tombstone. Closing it keeps every open request's head repository alive.
      const stragglers = await tx
        .update(schema.pullRequest)
        .set({ state: 'closed' })
        .where(this.openRequestsHeadedBy(repository.id))
        .returning({ issueId: schema.pullRequest.issueId });
      for (const { issueId } of stragglers) {
        await closeIssue(tx, { issueId, actorId: requesterId });
      }

      await tx
        .delete(schema.repository)
        .where(eq(schema.repository.id, repository.id));
    });
  }

  /** Open requests into other repositories. Requests into this one go with it. */
  private openRequestsHeadedBy(repositoryId: string) {
    return and(
      eq(schema.pullRequest.headRepositoryId, repositoryId),
      ne(schema.pullRequest.baseRepositoryId, repositoryId),
      eq(schema.pullRequest.state, 'open'),
    );
  }

  /** `ownId` is the repository being renamed, which may keep its own slug. */
  private async freeSlug(namespace: Namespace, name: string, ownId?: string) {
    const { slugified, slugifiedWithSuffix } = titleToSlug(name);
    if (RESERVED_REPOSITORY_SLUGS.has(slugified)) return slugifiedWithSuffix;
    const [taken] = await this.db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(
        and(inNamespace(namespace), eq(schema.repository.slug, slugified)),
      );
    return !taken || taken.id === ownId ? slugified : slugifiedWithSuffix;
  }

  /** The namespace `/name/…` points at. Organization slugs and usernames never collide, so the order only saves a query. */
  private async namespaceNamed(name: string): Promise<Namespace> {
    const [organization] = await this.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, name));
    if (organization) return { organizationId: organization.id };

    const user = await this.usersService.getUserByUsername(name);
    return { userId: user.id };
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
    return this.authorizeAs('read', { username, slug, requesterId });
  }

  private authorizeAs(
    operation: RepositoryOperation,
    {
      username,
      slug,
      requesterId,
    }: { username: string; slug: string; requesterId?: string },
  ) {
    return this.access.authorize({
      username,
      repo: slug,
      actor: actorOf(requesterId),
      operation,
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
        readCommitSummary({ gitDir: directory, ref }),
      ]);

      return {
        ref,
        path: prefix,
        commitCount,
        commit,
        // per-entry history would be one walk per path, which only the index makes cheap; a point-in-time listing does without it
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
      commit: commits.get('') ?? null,
      entries: entries.map((entry) => ({
        ...entry,
        lastCommit: commits.get(entry.path) ?? null,
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
      ? await readCommitSummary({ gitDir: directory, ref, path: filePath })
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

    const text = isTextBlob(blob.content);

    return {
      ref,
      path: filePath,
      oid: blob.oid,
      size: blob.size,
      encoding: text ? 'utf-8' : 'base64',
      content: blob.content?.toString(text ? 'utf8' : 'base64') ?? null,
      commit: lastCommit ?? commits.get(filePath) ?? null,
    };
  }

  async getRepositoryReadme({
    username,
    repo,
    requesterId,
    ref: requestedRef,
    path: directoryPath = '',
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    ref?: string;
    /** Directory to look in; the root of the repository when omitted. */
    path?: string;
  }): Promise<GetRepositoryReadmeResponseDTO> {
    const prefix = normalizeTreePath(directoryPath);

    const { directory, ref } = await this.openRepository({
      username,
      repo,
      requesterId,
      ref: requestedRef,
    });

    const path = await findReadmePath({ gitDir: directory, ref, prefix });
    if (!path) return { ref, path: null, size: 0, content: null };

    const blob = await readBlob({ gitDir: directory, ref, path });
    if (!blob) return { ref, path: null, size: 0, content: null };

    return {
      ref,
      path,
      size: blob.size,
      content: isTextBlob(blob.content) ? blob.content.toString('utf8') : null,
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

    const verdicts = await this.verification.verifyCommits({
      gitDir: directory,
      commits,
    });

    return {
      ref,
      from: commits.length ? before + 1 : 0,
      to: before + commits.length,
      total,
      commits: commits.map((commit) => ({
        ...commit,
        verification: verdicts.get(commit.sha) ?? null,
      })),
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

    const verdicts = await this.verification.verifyCommits({
      gitDir: directory,
      commits: [commit],
    });

    return { ...commit, verification: verdicts.get(commit.sha) ?? null };
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

  async getRepositoryLanguages({
    username,
    repo,
    requesterId,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
  }): Promise<GetRepositoryLanguagesResponseDTO> {
    const { repository, directory, ref } = await this.openRepository({
      username,
      repo,
      requesterId,
    });

    const languages = await this.languages.getLanguages({
      repositoryId: repository.id,
      repoDirectory: directory,
      ref,
    });

    const total = languages.reduce((sum, { bytes }) => sum + bytes, 0);

    // pool anything which is less than half a percentage
    const rows = languages.map(({ language, bytes }) => ({
      language,
      bytes,
      percent: (bytes / total) * 100,
    }));
    const shown = rows.filter(({ percent }) => percent >= MIN_LANGUAGE_PERCENT);
    const pooled = rows.filter(({ percent }) => percent < MIN_LANGUAGE_PERCENT);

    if (pooled.length === 0) return { languages: shown };

    return {
      languages: [
        ...shown,
        {
          language: 'Others',
          bytes: pooled.reduce((sum, { bytes }) => sum + bytes, 0),
          percent: pooled.reduce((sum, { percent }) => sum + percent, 0),
        },
      ],
    };
  }

  /** The index only ever holds HEAD, so this searches the default branch whatever the page is showing. */
  async searchRepositoryCode({
    username,
    repo,
    requesterId,
    query,
    limit = DEFAULT_SEARCH_LIMIT,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query: string;
    limit?: number;
  }): Promise<SearchRepositoryCodeResponseDTO> {
    const { repository, directory } = await this.openRepository({
      username,
      repo,
      requesterId,
    });

    return this.codeSearch.searchRepository({
      repositoryId: repository.id,
      isPublic: repository.visibility === 'public',
      repoDirectory: directory,
      query,
      limit,
    });
  }

  /** Who starred the repository, most recent first. */
  async getRepositoryStargazers({
    username,
    repo,
    requesterId,
    query = {},
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query?: GetRepositoryStargazersQueryDTO;
  }): Promise<GetRepositoryStargazersResponseDTO> {
    const repository = await this.authorizeRead({
      username,
      slug: repo,
      requesterId,
    });
    const { pageSize, after } = this.page(
      query,
      schema.stars.createdAt,
      schema.stars.id,
    );

    const rows = await this.db
      .select({
        id: schema.stars.id,
        starredAt: schema.stars.createdAt,
        username: schema.user.username,
        name: schema.user.name,
        image: schema.user.image,
      })
      .from(schema.stars)
      .innerJoin(schema.user, eq(schema.user.id, schema.stars.userId))
      .where(and(eq(schema.stars.repositoryId, repository.id), after))
      .orderBy(desc(schema.stars.createdAt), desc(schema.stars.id))
      .limit(pageSize + 1);

    const { page, nextCursor, hasMore } = paginate(rows, pageSize, (row) => ({
      date: row.starredAt,
      id: row.id,
    }));

    return {
      // an account without a username has nothing to link to, so it is left out
      stargazers: page.flatMap(
        ({ username: handle, name, image, starredAt }) =>
          handle
            ? [
                {
                  username: handle,
                  name,
                  image,
                  starredAt: starredAt.toISOString(),
                },
              ]
            : [],
      ),
      nextCursor,
      hasMore,
    };
  }

  /** Forks of the repository the requester is allowed to see, newest push first. */
  async getRepositoryForks({
    username,
    repo,
    requesterId,
    query = {},
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query?: GetRepositoryForksQueryDTO;
  }): Promise<GetRepositoryForksResponseDTO> {
    const repository = await this.authorizeRead({
      username,
      slug: repo,
      requesterId,
    });
    const { pageSize, after } = this.page(
      query,
      schema.repository.lastPushedAt,
      schema.repository.id,
    );

    const rows = await this.db
      .select({
        id: schema.repository.id,
        slug: schema.repository.slug,
        name: schema.repository.name,
        description: schema.repository.description,
        lastPushedAt: schema.repository.lastPushedAt,
        username: ownerNameOf(schema.user, schema.organization),
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actorOf(requesterId)),
      )
      .leftJoin(
        schema.member,
        organizationMembership(
          schema.repository.organizationId,
          actorOf(requesterId),
        ),
      )
      .where(
        and(
          eq(schema.repository.parentRepositoryId, repository.id),
          // a private fork is the forker's business, not the parent's
          readableBy(actorOf(requesterId)),
          after,
        ),
      )
      .orderBy(desc(schema.repository.lastPushedAt), desc(schema.repository.id))
      .limit(pageSize + 1);

    const { page, nextCursor, hasMore } = paginate(rows, pageSize, (row) => ({
      date: row.lastPushedAt,
      id: row.id,
    }));

    return {
      forks: page.flatMap((row) =>
        row.username
          ? [
              {
                username: row.username,
                slug: row.slug,
                name: row.name,
                description: row.description,
                lastPushedAt: row.lastPushedAt.toISOString(),
              },
            ]
          : [],
      ),
      nextCursor,
      hasMore,
    };
  }

  /** Authors of the default branch, most commits first, read from the index. */
  async getRepositoryContributors({
    username,
    repo,
    requesterId,
    query = {},
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query?: GetRepositoryContributorsQueryDTO;
  }): Promise<GetRepositoryContributorsResponseDTO> {
    const repository = await this.authorizeRead({
      username,
      slug: repo,
      requesterId,
    });

    const { contributors, totalCommits, totalContributors } =
      await this.contributions.listContributors({
        repositoryId: repository.id,
        limit: query.limit,
      });

    return {
      contributors: contributors.map((row) => ({
        username: row.username,
        name: row.authorName,
        image: row.image,
        commits: row.commits,
        percent: totalCommits > 0 ? (row.commits / totalCommits) * 100 : 0,
        lastCommittedAt: row.lastCommittedAt.toISOString(),
      })),
      totalCommits,
      totalContributors,
    };
  }

  /** Page size and the keyset predicate shared by the cursor-paged lists. */
  private page(
    query: { cursor?: string; limit?: number },
    dateColumn: PgColumn,
    idColumn: PgColumn,
  ) {
    const requested = Number(query.limit);
    const pageSize = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !decoded) throw new InvalidCursorError();

    return {
      pageSize,
      after: decoded
        ? or(
            lt(dateColumn, decoded.date),
            and(eq(dateColumn, decoded.date), lt(idColumn, decoded.id)),
          )
        : undefined,
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

  /** Resolves the requested branch or sha to a revision. `detached` marks a sha, which has no moving tip and so is never indexed. */
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
    await this.materializer.materialize(
      repository.id,
      directory,
      repository.defaultBranch,
    );

    // Pushes index too; this catches repositories that predate code search, while the objects are already on disk.
    this.codeSearch.indexInBackground({
      repositoryId: repository.id,
      isPublic: repository.visibility === 'public',
      repoDirectory: directory,
    });

    // Keep the contribution index warm while the objects are hot. The profile graph reads the index only, so rendering it never materializes anything itself. A no-op once the default tip is indexed.
    await this.contributions.sync({
      repositoryId: repository.id,
      repoDirectory: directory,
    });

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

function actorOf(requesterId: string | undefined): Actor {
  return requesterId ? { userId: requesterId } : null;
}

/** Where a repository's slug has to be unique: its organization, or its owner's own repositories. */
type Namespace = { organizationId: string } | { userId: string };

function inNamespace(namespace: Namespace) {
  return 'organizationId' in namespace
    ? eq(schema.repository.organizationId, namespace.organizationId)
    : and(
        eq(schema.repository.ownerId, namespace.userId),
        isNull(schema.repository.organizationId),
      );
}

function sameNamespace(a: Namespace, b: Namespace) {
  return 'organizationId' in a
    ? 'organizationId' in b && a.organizationId === b.organizationId
    : 'userId' in b && a.userId === b.userId;
}

function organizationIdOf(namespace: Namespace) {
  return 'organizationId' in namespace ? namespace.organizationId : null;
}

function namespaceOf(
  repository: Pick<Repository, 'ownerId' | 'organizationId'>,
): Namespace {
  return repository.organizationId
    ? { organizationId: repository.organizationId }
    : { userId: repository.ownerId };
}

/** Name or description contains `q`, ignoring case. A blank query filters nothing. */
function matching(q: string | undefined) {
  const needle = q?.trim();
  if (!needle) return undefined;

  const pattern = `%${escapeLike(needle)}%`;
  return or(
    ilike(schema.repository.name, pattern),
    ilike(schema.repository.description, pattern),
  );
}

/** One extra row was fetched: it only tells us whether another page exists. */
function paginate<T>(
  rows: T[],
  pageSize: number,
  keyOf: (row: T) => { date: Date; id: string },
) {
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page.at(-1);

  return {
    page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null,
  };
}
