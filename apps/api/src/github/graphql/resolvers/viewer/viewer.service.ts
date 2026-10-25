import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../../database/database.module.js';
import { isoTimestamp, sameName } from '../../../../lib/db/sql.js';
import { orNull } from '../../../../lib/github/authorize.js';
import {
  CouldNotResolveError,
  GithubForbiddenError,
} from '../../../../lib/github/github.errors.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { decodeNodeId } from '../../../../lib/github/node-id.js';
import { commentOf } from '../../../../lib/github/node-lookup.js';
import {
  toIssueCommentNode,
  toLabelNode,
  toOrganizationNode,
  toStatusCheckRollupNode,
  toStatusContextNode,
  toUserNode,
} from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { CommitStatusesService } from '../../../../resources/commit-statuses/commit-statuses.service.js';
import { RepositoryNodesService } from '../repository/repository-nodes.service.js';

@Injectable()
export class ViewerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly repositories: RepositoryNodesService,
    private readonly statuses: CommitStatusesService,
  ) {}

  async viewer(viewer: GithubViewer | null, loaders: Loaders) {
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

  async user(login: string, loaders: Loaders) {
    const row = await loaders.usersByLogin.load(login);
    if (!row)
      throw new CouldNotResolveError(
        `Could not resolve to a User with the login of '${login}'.`,
      );
    return toUserNode(row, githubOrigins(this.config));
  }

  async organization(login: string) {
    const [row] = await this.db
      .select()
      .from(schema.organization)
      .where(sameName(schema.organization.slug, login));
    if (!row)
      throw new CouldNotResolveError(
        `Could not resolve to an Organization with the login of '${login}'.`,
      );
    return toOrganizationNode(row, githubOrigins(this.config));
  }

  async repositoryOwner(login: string, loaders: Loaders) {
    const [organization] = await this.db
      .select()
      .from(schema.organization)
      .where(sameName(schema.organization.slug, login));
    if (organization)
      return toOrganizationNode(organization, githubOrigins(this.config));
    const user = await loaders.usersByLogin.load(login);
    return user ? toUserNode(user, githubOrigins(this.config)) : null;
  }

  async node(id: string, viewer: GithubViewer | null, loaders: Loaders) {
    const found = await this.lookup(id, viewer, loaders);
    if (!found)
      throw new CouldNotResolveError(
        `Could not resolve to a node with the global id of '${id}'`,
      );
    return found;
  }

  nodes(ids: string[], viewer: GithubViewer | null, loaders: Loaders) {
    return Promise.all(ids.map((id) => this.lookup(id, viewer, loaders)));
  }

  /** A node the viewer cannot read resolves to null, as on GitHub. */
  private async lookup(
    id: string,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
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
    const requesterId = viewer?.userId;
    if (decoded?.type === 'Repository') {
      return orNull(this.repositories.load(decoded.id, viewer));
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
      const repository = await orNull(
        this.repositories.load(label.repositoryId, viewer),
      );
      return repository ? toLabelNode(label, repository) : null;
    }
    if (decoded?.type === 'Issue' || decoded?.type === 'PullRequest') {
      const found = await this.repositories.issueById(decoded.id, viewer);
      return found?.kind === decoded.type ? found : null;
    }
    if (decoded?.type === 'IssueComment') {
      const comment = await commentOf(this.db, decoded.id);
      // Loading the issue is what checks the viewer may read the comment.
      const issue =
        comment && (await this.repositories.issueById(comment.issueId, viewer));
      if (!issue) return null;
      const viewerLogin = requesterId
        ? ((await loaders.usersById.load(requesterId))?.username ?? null)
        : null;
      return toIssueCommentNode(comment, issue, viewerLogin);
    }
    if (decoded?.type === 'StatusContext') {
      const status = await this.statuses.findById(decoded.id);
      if (!status) return null;
      const repository = await orNull(
        this.repositories.load(status.repositoryId, viewer),
      );
      return repository
        ? toStatusContextNode(status, status.repositoryId)
        : null;
    }
    if (decoded?.type === 'StatusCheckRollup') {
      const [repositoryId, sha] = decoded.id.split(':');
      if (!repositoryId || !sha) return null;
      if (!(await orNull(this.repositories.load(repositoryId, viewer))))
        return null;
      // ponytail: the repository's own statuses only; a pull request's rollup also folds in its fork's, which this id does not name.
      const status = (
        await this.statuses.combinedFor([repositoryId], [sha])
      ).get(sha);
      return status ? toStatusCheckRollupNode(status, repositoryId) : null;
    }
    return null;
  }
}
