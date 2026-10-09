import { Inject } from '@nestjs/common';
import { Args, Context, ID, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { DATABASE } from '../../../../database/database.module.js';
import { type Database, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { UserNode } from '../../types/user.type.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { type GraphqlContext } from '../../../../lib/github/loaders.js';
import {
  CouldNotResolveError,
  GithubForbiddenError,
} from '../../../../lib/github/github.errors.js';
import {
  toLabelNode,
  toOrganizationNode,
  toUserNode,
} from '../../../../lib/github/nodes.js';
import { isoTimestamp } from '../../../../lib/db/sql.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import { IssueNode } from '../../types/issue.type.js';
import { commentIssueOf, issueRefOf } from '../../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { OrganizationNode } from '../../types/organization.type.js';
import { eq } from 'drizzle-orm';
import { Node, RepositoryOwner } from '../../types/node.interface.js';
import { decodeNodeId } from '../../../../lib/github/node-id.js';

@Resolver()
@AllowAnonymous()
export class ViewerResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly repositories: RepositoryResolver,
    private readonly issueNodes: IssueResolver,
  ) {}

  @Query(() => UserNode, { description: 'The currently authenticated user.' })
  async viewer(
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
  ) {
    if (!viewer)
      throw new GithubForbiddenError(
        'This endpoint requires you to be authenticated.',
      );
    const row = await loaders.usersById.load(viewer.userId);
    if (!row)
      throw new GithubForbiddenError(
        'This endpoint requires you to be authenticated.',
      );
    return toUserNode(row, githubOrigins(this.config));
  }

  @Query(() => UserNode, { nullable: true })
  async user(
    @Args('login') login: string,
    @Context() { loaders }: GraphqlContext,
  ) {
    const row = await loaders.usersByLogin.load(login);
    if (!row)
      throw new CouldNotResolveError(
        `Could not resolve to a User with the login of '${login}'.`,
      );
    return toUserNode(row, githubOrigins(this.config));
  }

  @Query(() => OrganizationNode, { nullable: true })
  async organization(@Args('login') login: string) {
    const [row] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.slug, login));
    if (!row)
      throw new CouldNotResolveError(
        `Could not resolve to an Organization with the login of '${login}'.`,
      );
    return toOrganizationNode(row, githubOrigins(this.config));
  }

  @Query(() => RepositoryOwner, { nullable: true })
  async repositoryOwner(
    @Args('login') login: string,
    @Context() context: GraphqlContext,
  ) {
    const [organization] = await this.db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.slug, login));
    if (organization)
      return toOrganizationNode(organization, githubOrigins(this.config));
    const user = await context.loaders.usersByLogin.load(login);
    return user ? toUserNode(user, githubOrigins(this.config)) : null;
  }

  @Query(() => Node, { nullable: true })
  async node(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GraphqlContext,
  ) {
    const found = await this.lookup(id, context);
    if (!found)
      throw new CouldNotResolveError(
        `Could not resolve to a node with the global id of '${id}'`,
      );
    return found;
  }

  @Query(() => [Node], { nullable: 'items' })
  nodes(
    @Args('ids', { type: () => [ID] }) ids: string[],
    @Context() context: GraphqlContext,
  ) {
    return Promise.all(ids.map((id) => this.lookup(id, context)));
  }

  /** A node the viewer cannot read resolves to null, as on GitHub. */
  private async lookup(id: string, context: GraphqlContext) {
    const { loaders, req } = context;
    const decoded = decodeNodeId(id);
    if (decoded?.type === 'User') {
      const row = await loaders.usersById.load(decoded.id);
      return row ? toUserNode(row, githubOrigins(this.config)) : null;
    }
    if (decoded?.type === 'Organization') {
      const [row] = await this.db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, decoded.id));
      return row ? toOrganizationNode(row, githubOrigins(this.config)) : null;
    }
    const requesterId = req.githubViewer?.userId;
    if (decoded?.type === 'Repository') {
      return this.repositories.load(decoded.id, requesterId).catch(() => null);
    }
    if (decoded?.type === 'Label') {
      const [label] = await this.db
        .select({
          id: schema.label.id,
          name: schema.label.name,
          description: schema.label.description,
          color: schema.label.color,
          createdAt: isoTimestamp(schema.label.createdAt),
          updatedAt: isoTimestamp(schema.label.updatedAt),
          repositoryId: schema.label.repositoryId,
        })
        .from(schema.label)
        .where(eq(schema.label.id, decoded.id));
      if (!label) return null;
      const repository = await this.repositories.load(label.repositoryId, requesterId).catch(() => null);
      return repository ? toLabelNode(label, repository) : null;
    }
    if (decoded?.type === 'Issue' || decoded?.type === 'PullRequest') {
      const found = await this.issueById(decoded.id, requesterId);
      return found?.kind === decoded.type ? found : null;
    }
    if (decoded?.type === 'IssueComment') {
      const ref = await commentIssueOf(this.db, decoded.id);
      const issue = ref && (await this.issueById(ref.issueId, requesterId));
      if (!(issue instanceof IssueNode)) return null;
      const { nodes } = await this.issueNodes.comments(issue, req.githubViewer, context);
      return nodes.find((comment) => comment.ghostId === decoded.id) ?? null;
    }
    return null;
  }

  private async issueById(issueId: string, requesterId?: string) {
    const ref = await issueRefOf(this.db, issueId);
    if (!ref) return null;
    const repository = await this.repositories.load(ref.repositoryId, requesterId).catch(() => null);
    return repository && this.issueNodes.fromRepository(repository, ref.number, requesterId).catch(() => null);
  }
}
