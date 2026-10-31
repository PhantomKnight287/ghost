import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { sameName } from '../../../lib/db/sql.js';
import type { ArchiveFormat } from '../../../lib/git/archive/archive.js';
import { findReadmePath } from '../../../lib/git/blob/find-readme.js';
import { isTextBlob, readBlob } from '../../../lib/git/blob/read-blob.js';
import { resolveDefaultRef } from '../../../lib/git/tree/resolve-ref.js';
import {
  GithubNotFoundError,
  RequiresAuthenticationError,
  UnprocessableError,
} from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  pageOf,
  RestPage,
  toRepositoryRest,
} from '../../../lib/github/rest.js';
import { hasScope } from '../../../lib/github/scopes.js';
import {
  oauthAppBlockedIn,
  requireOauthAppAllowed,
} from '../../../lib/organizations/oauth-app-access.js';
import {
  type Affiliation,
  acceptedCollaboration,
  affiliationsOf,
  grantedTo,
  organizationMembership,
  readableBy,
  repositoryFullNameOf,
} from '../../../lib/repositories/access/repository-access.js';
import { RepositoriesService } from '../../../resources/repositories/repositories.service.js';
import { RepositoryMaterializerService } from '../../../services/git/materializer/repository-materializer.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import { requireScope, requireWriteScope } from '../../auth/require-scopes.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import type { GithubCreateRepositoryDTO } from './dto/create-repository.dto.js';
import type {
  GithubListOrganizationRepositoriesQueryDTO,
  GithubListRepositoriesQueryDTO,
  GithubListUserRepositoriesQueryDTO,
  GithubListViewerRepositoriesQueryDTO,
  RepositorySort,
} from './dto/list-repositories.dto.js';
import type {
  GithubCodeownersErrorsDTO,
  GithubReadmeDTO,
  GithubRepositoryDTO,
} from './dto/repository.dto.js';
import type { GithubUpdateRepositoryDTO } from './dto/update-repository.dto.js';

const AFFILIATIONS: Affiliation[] = [
  'owner',
  'collaborator',
  'organization_member',
];

/** GitHub's REST repositories: listing, reading, creating, updating and deleting them, and a repository's README. */
@Injectable()
export class GithubReposService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositoryNodes: RepositoryNodesService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly repositories: RepositoriesService,
    private readonly config: ConfigService,
  ) {}

  async get({ owner, repo, viewer }: GithubRepositoryTarget) {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    return toRepositoryRest(node, githubOrigins(this.config));
  }

  /** The README at the default branch, base64 as GitHub returns it. */
  /** GitHub redirects to codeload; Ghost streams from the same host, so the token still applies. */
  async archive({
    owner,
    repo,
    viewer,
    ref,
    format,
  }: GithubRepositoryTarget & { ref?: string; format: ArchiveFormat }) {
    // the GitHub-side checks, an OAuth app an organization has not approved among them
    await this.repositoryNodes.repository(owner, repo, viewer);
    return this.repositories.getArchive({
      username: owner,
      repo,
      ref,
      format,
      requesterId: viewer?.userId,
    });
  }

  async readme({
    owner,
    repo,
    viewer,
  }: GithubRepositoryTarget): Promise<GithubReadmeDTO> {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    const gitDir = await this.materializer.open({
      id: node.ghostId,
      defaultBranch: node.defaultBranch,
    });
    const ref = await resolveDefaultRef({
      gitDir,
      defaultBranch: node.defaultBranch,
    });
    const path = await findReadmePath({ gitDir, ref });
    const blob = path && (await readBlob({ gitDir, ref, path }));
    if (!path || !blob || !isTextBlob(blob.content))
      throw new GithubNotFoundError();
    return {
      type: 'file',
      encoding: 'base64',
      size: blob.size,
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      content: blob.content.toString('base64'),
    };
  }

  /** 404 when the ref has no CODEOWNERS file, as on GitHub. */
  async codeownersErrors({
    owner,
    repo,
    viewer,
    ref,
  }: GithubRepositoryTarget & {
    ref?: string;
  }): Promise<GithubCodeownersErrorsDTO> {
    await this.repositoryNodes.repository(owner, repo, viewer);
    const { path, errors } = await this.repositories.getCodeowners({
      username: owner,
      repo,
      ref,
      requesterId: viewer?.userId,
    });
    if (!path) throw new GithubNotFoundError();
    return { errors };
  }

  /** For the viewer, or in `organization`; `route` names the REST route in a missing-scope error. */
  async create(
    viewer: GithubViewer | null,
    body: GithubCreateRepositoryDTO,
    organization: string | undefined,
    route: string,
  ) {
    if (!viewer) throw new RequiresAuthenticationError();
    const visibility = body.visibility ?? (body.private ? 'private' : 'public');
    requireWriteScope(viewer, route, {
      isPrivate: visibility === 'private',
    });
    if (organization && viewer.oauthClientId)
      await requireOauthAppAllowed(this.db, viewer.oauthClientId, organization);
    const created = await this.repositories.createRepository(
      {
        name: body.name,
        description: body.description,
        visibility,
        organization,
        readme: body.auto_init,
        gitignoreTemplate: body.gitignore_template,
        licenseTemplate: body.license_template,
      },
      viewer.userId,
    );
    const node = await this.repositoryNodes.load(created.id, viewer);
    return toRepositoryRest(node, githubOrigins(this.config));
  }

  /** `GET /user/repos`: what the viewer holds a role on, private repositories included. */
  listForViewer(
    viewer: GithubViewer | null,
    query: GithubListViewerRepositoriesQueryDTO,
  ) {
    if (!viewer) throw new RequiresAuthenticationError();
    if (query.type && (query.visibility || query.affiliation))
      throw new UnprocessableError(
        'If you specify visibility or affiliation, you cannot specify type.',
      );
    const type = query.type ?? 'all';
    const affiliations = affiliationsOf({ userId: viewer.userId });
    const chosen =
      (query.affiliation?.split(',') as Affiliation[] | undefined) ??
      (type === 'owner'
        ? ['owner']
        : type === 'member'
          ? ['collaborator', 'organization_member']
          : AFFILIATIONS);
    const visibility =
      query.visibility ??
      (type === 'public' || type === 'private' ? type : 'all');
    return this.list(
      viewer,
      and(
        or(...chosen.map((affiliation) => affiliations[affiliation])),
        visibility === 'all'
          ? undefined
          : eq(schema.repository.visibility, visibility),
      ),
      query,
      'full_name',
    );
  }

  /** `GET /users/:username/repos`: public repositories only, whoever asks, as on GitHub. An organization's login lists its own. */
  async listForUser(
    login: string,
    viewer: GithubViewer | null,
    query: GithubListUserRepositoriesQueryDTO,
  ) {
    const [user] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sameName(schema.user.username, login));
    const [organization] = user
      ? []
      : await this.db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(sameName(schema.organization.slug, login));
    if (!user && !organization) throw new GithubNotFoundError();
    const owned = user
      ? and(
          eq(schema.repository.ownerId, user.id),
          isNull(schema.repository.organizationId),
        )
      : eq(schema.repository.organizationId, organization!.id);
    const member = user
      ? exists(
          this.db
            .select({ id: schema.repositoryCollaborator.id })
            .from(schema.repositoryCollaborator)
            .where(
              and(
                eq(
                  schema.repositoryCollaborator.repositoryId,
                  schema.repository.id,
                ),
                eq(schema.repositoryCollaborator.userId, user.id),
                isNotNull(schema.repositoryCollaborator.acceptedAt),
              ),
            ),
        )
      : sql`false`;
    const type = query.type ?? 'owner';
    return this.list(
      viewer,
      and(
        eq(schema.repository.visibility, 'public'),
        type === 'owner'
          ? owned
          : type === 'member'
            ? member
            : or(owned, member),
      ),
      query,
      'full_name',
    );
  }

  /** `GET /orgs/:org/repos`: what the viewer can read. */
  async listForOrganization(
    slug: string,
    viewer: GithubViewer | null,
    query: GithubListOrganizationRepositoriesQueryDTO,
  ) {
    const [organization] = await this.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(sameName(schema.organization.slug, slug));
    if (!organization) throw new GithubNotFoundError();
    const actor = viewer && { userId: viewer.userId };
    const filters: Record<NonNullable<typeof query.type>, SQL | undefined> = {
      all: undefined,
      public: eq(schema.repository.visibility, 'public'),
      private: eq(schema.repository.visibility, 'private'),
      forks: isNotNull(schema.repository.parentRepositoryId),
      sources: isNull(schema.repository.parentRepositoryId),
      member: grantedTo(actor),
    };
    return this.list(
      viewer,
      and(
        eq(schema.repository.organizationId, organization.id),
        readableBy(actor),
        filters[query.type ?? 'all'],
      ),
      query,
      'created',
    );
  }

  /** Only the settings Ghost keeps; making a repository private needs `repo`, as writing to one does. */
  async update(
    { owner, repo, viewer }: GithubRepositoryTarget,
    body: GithubUpdateRepositoryDTO,
  ) {
    if (!viewer) throw new RequiresAuthenticationError();
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    const visibility =
      body.visibility ??
      (body.private === undefined
        ? undefined
        : body.private
          ? 'private'
          : 'public');
    requireWriteScope(viewer, 'PATCH /repos/:owner/:repo', {
      isPrivate: node.isPrivate || visibility === 'private',
    });
    const { id } = await this.repositories.updateRepository({
      username: owner,
      slug: repo,
      requesterId: viewer.userId,
      changes: {
        name: body.name,
        description: body.description,
        visibility,
        defaultBranch: body.default_branch,
      },
    });
    return toRepositoryRest(
      await this.repositoryNodes.load(id, viewer),
      githubOrigins(this.config),
    );
  }

  async delete({ owner, repo, viewer }: GithubRepositoryTarget) {
    if (!viewer) throw new RequiresAuthenticationError();
    await this.repositoryNodes.repository(owner, repo, viewer);
    requireScope(viewer, 'DELETE /repos/:owner/:repo', 'delete_repo');
    await this.repositories.deleteRepository({
      username: owner,
      slug: repo,
      requesterId: viewer.userId,
    });
  }

  /** One page of the repositories `where` keeps that the viewer's token can reach: a token without `repo` sees no private ones, and an OAuth app an organization keeps out sees none of its. */
  private async list(
    viewer: GithubViewer | null,
    where: SQL | undefined,
    query: GithubListRepositoriesQueryDTO,
    defaultSort: RepositorySort,
  ) {
    const page = pageOf(query);
    const sort = query.sort ?? defaultSort;
    const direction = sql.raw(
      query.direction ?? (sort === 'full_name' ? 'asc' : 'desc'),
    );
    const key = {
      full_name: sql`lower(${repositoryFullNameOf(schema.user, schema.organization, schema.repository)})`,
      created: schema.repository.createdAt,
      updated: schema.repository.updatedAt,
      pushed: schema.repository.lastPushedAt,
    }[sort];
    const actor = viewer && { userId: viewer.userId };
    const rows = await this.db
      .select({
        id: schema.repository.id,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, actor),
      )
      .leftJoin(
        schema.member,
        organizationMembership(schema.repository.organizationId, actor),
      )
      .where(
        and(
          where,
          viewer && !hasScope(viewer.scopes, 'repo')
            ? eq(schema.repository.visibility, 'public')
            : undefined,
          viewer?.oauthClientId
            ? or(
                isNull(schema.repository.organizationId),
                not(
                  oauthAppBlockedIn(
                    schema.repository.organizationId,
                    viewer.oauthClientId,
                  ),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        sql`${key} ${direction} nulls last`,
        sql`${schema.repository.id} ${direction}`,
      )
      .offset(page.offset)
      .limit(page.perPage);
    // ponytail: one authorized load per row, up to 100 a page; load the nodes in one query if lists get hot.
    const nodes = await Promise.all(
      rows.map((row) => this.repositoryNodes.load(row.id, viewer)),
    );
    const origins = githubOrigins(this.config);
    return new RestPage<GithubRepositoryDTO>(
      nodes.map((node) => toRepositoryRest(node, origins)),
      page,
      rows[0]?.total ?? 0,
    );
  }
}
