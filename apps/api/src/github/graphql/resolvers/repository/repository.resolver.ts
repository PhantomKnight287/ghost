import { type Database, schema } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Args,
  Context,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { eq, sql } from 'drizzle-orm';
import { RefNode, RepositoryNode } from '../../types/repository.type.js';
import { DATABASE } from '../../../../database/database.module.js';
import { RepositoryAccessService } from '../../../../services/git/repository-access/repository-access.service.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { GithubViewer } from '../../../auth/github-request.js';
import { authorizeOrNotFound } from '../../../../lib/github/authorize.js';
import { RepositoryOwner } from '../../types/node.interface.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import {
  toLabelNode,
  toOrganizationNode,
  toRepositoryNode,
  toUserNode,
  type UserRow,
} from '../../../../lib/github/nodes.js';
import { encodeNodeId } from '../../../../lib/github/node-id.js';
import { ownerNameOf } from '../../../../lib/repositories/access/repository-access.js';
import { UserConnection, UserNode } from '../../types/user.type.js';
import { LabelConnection, LabelNode } from '../../types/label.type.js';
import { sliceConnection } from '../../connection.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';

@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly config: ConfigService,
    private readonly issues: IssuesService,
  ) {}

  @Query(() => RepositoryNode, { nullable: true })
  async repository(
    @Args('owner') owner: string,
    @Args('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const row = await authorizeOrNotFound(this.access, {
      owner,
      name,
      requesterId: viewer?.userId,
    });
    return this.toNode(row.id, row);
  }

  /** The node for a repository already authorized, for other resolvers (issue.repository, node(id:)). */
  async load(repositoryId: string, requesterId?: string) {
    const row = await this.access.authorizeById({ repositoryId, requesterId });
    return this.toNode(repositoryId, row);
  }

  @ResolveField(() => RepositoryOwner)
  async owner(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    const origins = githubOrigins(this.config);
    if (repository.organizationGhostId) {
      const [organization] = await this.db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, repository.organizationGhostId));
      return toOrganizationNode(organization!, origins);
    }
    return toUserNode(
      (await loaders.usersById.load(repository.ownerGhostId))!,
      origins,
    );
  }

  @ResolveField(() => RepositoryNode, { nullable: true })
  async parent(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
  ) {
    if (!repository.parentGhostId) return null;
    // A parent the viewer cannot read reads as no parent, as on GitHub.
    return this.load(repository.parentGhostId, viewer?.userId).catch(
      () => null,
    );
  }

  @ResolveField(() => RefNode, { nullable: true })
  defaultBranchRef(@Parent() repository: RepositoryNode) {
    const name = repository.defaultBranch ?? 'main';
    return Object.assign(new RefNode(), {
      id: encodeNodeId(
        'Repository',
        `${repository.ghostId}:refs/heads/${name}`,
      ),
      name,
      prefix: 'refs/heads/',
    });
  }

  private async toNode(
    repositoryId: string,
    row: Awaited<ReturnType<RepositoryAccessService['authorize']>>,
  ) {
    const [owner] = await this.db
      .select({ login: ownerNameOf(schema.user, schema.organization) })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, repositoryId));
    return toRepositoryNode(row, owner!.login, githubOrigins(this.config));
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  async labels(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('query', { nullable: true }) query?: string,
  ) {
    const { labels } = await this.issues.listLabels({ username: repository.ownerLogin, repo: repository.slug, requesterId: viewer?.userId });
    const matching = query ? labels.filter((label) => label.name.toLowerCase().includes(query.toLowerCase())) : labels;
    return sliceConnection(matching.map((label) => toLabelNode(label, repository)), { first });
  }

  @ResolveField(() => LabelNode, { nullable: true })
  async label(@Parent() repository: RepositoryNode, @Args('name') name: string, @Viewer() viewer: GithubViewer | null) {
    const { labels } = await this.issues.listLabels({ username: repository.ownerLogin, repo: repository.slug, requesterId: viewer?.userId });
    const label = labels.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    return label ? toLabelNode(label, repository) : null;
  }

  @ResolveField(() => UserConnection)
  async assignableUsers(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('query', { nullable: true }) query?: string,
  ) {
    const ids = await this.assignableUserIds(repository.ghostId);
    const rows = (await loaders.usersById.loadMany(ids)).filter((row): row is UserRow => !!row && !(row instanceof Error));
    const matching = query ? rows.filter((row) => `${row.username} ${row.name}`.toLowerCase().includes(query.toLowerCase())) : rows;
    return sliceConnection(matching.map((row) => toUserNode(row, githubOrigins(this.config))), { first });
  }

  /** Who gh offers as assignees: the owner, accepted collaborators and organization members, as the assignee picker's involved set. */
  private async assignableUserIds(repositoryId: string) {
    const rows = await this.db.execute<{ id: string }>(sql`
      select owner_id as id from repository where id = ${repositoryId}
      union select user_id from repository_collaborator where repository_id = ${repositoryId} and accepted_at is not null
      union select m.user_id from member m join repository r on r.organization_id = m.organization_id where r.id = ${repositoryId}
    `);
    return rows.rows.map((row) => row.id);
  }
}


@Resolver(() => UserNode)
@AllowAnonymous()
export class UserRepositoryResolver {
  constructor(private readonly repositories: RepositoryResolver, private readonly access: RepositoryAccessService) {}

  @ResolveField(() => RepositoryNode, { nullable: true })
  async repository(@Parent() owner: UserNode, @Args('name') name: string, @Viewer() viewer: GithubViewer | null) {
    return this.repositories.repository(owner.login, name, viewer).catch(() => null);
  }
}
