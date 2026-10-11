import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  type SQL,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { isoTimestamp } from '../../../lib/db/sql.js';
import {
  GithubValidationError,
  RequiresAuthenticationError,
} from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  type IssueExtras,
  linkHeader,
  type Page,
  type RestCommentSource,
  type RestContext,
  toCommentRest,
  toIssueRest,
  toLabelRest,
  toUserRest,
} from '../../../lib/github/rest.js';
import { UserNotFoundError } from '../../../lib/users/users.errors.js';
import type { IssueDTO } from '../../../resources/issues/dto/issue.dto.js';
import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { requireWriteScope } from '../../auth/require-scopes.js';
import { RepositoryPermission } from '../../graphql/enums.js';
import { RepositoryResolver } from '../../graphql/resolvers/repository/repository.resolver.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';

const TRIAGE_OR_ABOVE: (RepositoryPermission | null)[] = [
  RepositoryPermission.ADMIN,
  RepositoryPermission.MAINTAIN,
  RepositoryPermission.WRITE,
  RepositoryPermission.TRIAGE,
];

const WRITE_OR_ABOVE: (RepositoryPermission | null)[] = [
  RepositoryPermission.ADMIN,
  RepositoryPermission.MAINTAIN,
  RepositoryPermission.WRITE,
];

const restUserColumns = {
  ghostId: schema.user.id,
  numericId: schema.user.numericId,
  login: sql<string>`${schema.user.username}`,
  avatarUrl: schema.user.image,
};

/** What the REST issue, comment and label routes share: the ids and users their responses embed, the lookups GitHub's paths need, and the label and assignee rules GitHub has and Ghost does not. */
@Injectable()
export class GithubIssuesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly issueService: IssuesService,
    private readonly repositories: RepositoryResolver,
    private readonly config: ConfigService,
  ) {}

  /** The repository behind a REST path, as the viewer may see it: 404 when private and unreadable, or when the token lacks `repo`. */
  readable(owner: string, repo: string, viewer: GithubViewer | null) {
    return this.repositories.repository(owner, repo, viewer);
  }

  /** The repository behind a REST path a write is aimed at, refusing anonymous callers and tokens without the scope the write needs. */
  async writable(
    owner: string,
    repo: string,
    viewer: GithubViewer | null,
    route: string,
  ) {
    if (!viewer) throw new RequiresAuthenticationError();
    const repository = await this.readable(owner, repo, viewer);
    requireWriteScope(viewer, route, repository);
    return { repository, viewer };
  }

  ref(repository: RepositoryNode, viewer: GithubViewer | null) {
    return {
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
    };
  }

  /** Sets GitHub's `Link` header for a page of `total` items, linking back to the URL that was asked for. */
  link(request: Request, response: Response, page: Page, total: number) {
    const url = new URL(request.originalUrl, githubOrigins(this.config).api);
    const link = linkHeader(url, page, total);
    if (link) response.setHeader('Link', link);
  }

  /** GitHub drops labels and assignees sent by someone who cannot triage, where Ghost would refuse the whole write. */
  canTriage(repository: RepositoryNode) {
    return TRIAGE_OR_ABOVE.includes(repository.viewerPermission);
  }

  async issues(repository: RepositoryNode, issues: IssueDTO[]) {
    const [context, extras] = await Promise.all([
      this.context(repository, {
        logins: issues.flatMap((issue) => [
          issue.authorUsername,
          ...issue.assignees,
          ...(issue.closedByUsername ? [issue.closedByUsername] : []),
        ]),
        labels: issues.flatMap((issue) => issue.labels),
      }),
      this.issueExtras(issues.map((issue) => issue.id)),
    ]);
    return issues.map((issue) =>
      toIssueRest(issue, extras.get(issue.id) as IssueExtras, context),
    );
  }

  async issue(repository: RepositoryNode, issue: IssueDTO) {
    const [rest] = await this.issues(repository, [issue]);
    return rest;
  }

  async labels(repository: RepositoryNode, labels: LabelDTO[]) {
    const context = await this.context(repository, { logins: [], labels });
    return labels.map((label) => toLabelRest(label, context));
  }

  async comments(repository: RepositoryNode, comments: RestCommentSource[]) {
    const context = await this.context(repository, {
      logins: comments.map((comment) => comment.authorUsername),
      labels: [],
    });
    return comments.map((comment) => toCommentRest(comment, context));
  }

  /** A comment by its GitHub id, with the issue it belongs to; 404 when it is in another repository. */
  async commentByNumericId(repository: RepositoryNode, numericId: number) {
    return this.commentWhere(
      repository,
      eq(schema.issueComment.numericId, numericId),
    );
  }

  async commentById(repository: RepositoryNode, id: string) {
    return this.commentWhere(repository, eq(schema.issueComment.id, id));
  }

  private async commentWhere(repository: RepositoryNode, condition: SQL) {
    const [comment]: RestCommentSource[] = await this.db
      .select({
        id: schema.issueComment.id,
        numericId: schema.issueComment.numericId,
        body: schema.issueComment.body,
        createdAt: isoTimestamp(schema.issueComment.createdAt),
        updatedAt: isoTimestamp(schema.issueComment.updatedAt),
        authorUsername: sql<string>`coalesce(${schema.user.username}, '')`,
        issueNumber: schema.issue.number,
        isPullRequest: schema.issue.isPullRequest,
      })
      .from(schema.issueComment)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.issueComment.issueId))
      .innerJoin(schema.user, eq(schema.user.id, schema.issueComment.authorId))
      .where(and(condition, eq(schema.issue.repositoryId, repository.ghostId)));
    if (!comment) throw new NotFoundException();
    return comment;
  }

  /** 404 unless `login` names a user; Ghost lets any user be assigned. */
  async requireUser(login: string) {
    const [user] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.username, login));
    if (!user) throw new NotFoundException();
  }

  async labelByName(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    name: string,
  ) {
    const { labels } = await this.issueService.listLabels(
      this.ref(repository, viewer),
    );
    const label = labels.find((candidate) => candidate.name === name);
    if (!label) throw new NotFoundException();
    return label;
  }

  /** Creates the labels in `names` the repository does not have yet, as GitHub does when an issue is given one; only someone who can write may. */
  async ensureLabels(
    repository: RepositoryNode,
    viewer: GithubViewer,
    names: string[],
  ) {
    if (names.length === 0) return;
    const { labels } = await this.issueService.listLabels(
      this.ref(repository, viewer),
    );
    const existing = new Set(labels.map((label) => label.name));
    const missing = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ].filter((name) => !existing.has(name));
    if (missing.length === 0) return;
    if (!WRITE_OR_ABOVE.includes(repository.viewerPermission))
      throw new GithubValidationError([
        { resource: 'Label', field: 'labels', code: 'invalid' },
      ]);
    for (const name of missing)
      await this.issueService.createLabel({
        username: repository.ownerLogin,
        repo: repository.slug,
        requesterId: viewer.userId,
        body: { name, color: 'ededed' },
      });
  }

  /** Runs an assignee write, answering an unknown login as GitHub does: 422 on the `assignees` field. */
  async assigning<T>(write: () => Promise<T>) {
    try {
      return await write();
    } catch (error) {
      if (error instanceof UserNotFoundError)
        throw new GithubValidationError([
          { resource: 'Issue', field: 'assignees', code: 'invalid' },
        ]);
      throw error;
    }
  }

  /** People with access to the repository: its owner, accepted collaborators and organization members. */
  async assignees(repository: RepositoryNode, page: Page) {
    const where = and(
      isNotNull(schema.user.username),
      sql`${schema.user.id} in (
        select ${repository.ownerGhostId}::text
        union select user_id from repository_collaborator where repository_id = ${repository.ghostId} and accepted_at is not null
        union select user_id from member where organization_id = ${repository.organizationGhostId}
      )`,
    );
    const [users, [total]] = await Promise.all([
      this.db
        .select(restUserColumns)
        .from(schema.user)
        .where(where)
        .orderBy(asc(schema.user.username))
        .limit(page.perPage)
        .offset(page.offset),
      this.db.select({ total: count() }).from(schema.user).where(where),
    ]);
    const origins = githubOrigins(this.config);
    return {
      users: users.map((user) => toUserRest(user, origins)),
      total: total?.total ?? 0,
    };
  }

  private async context(
    repository: RepositoryNode,
    related: { logins: string[]; labels: LabelDTO[] },
  ): Promise<RestContext> {
    const logins = [...new Set(related.logins.filter(Boolean))];
    const labelIds = [...new Set(related.labels.map((label) => label.id))];
    const [users, labels] = await Promise.all([
      logins.length > 0
        ? this.db
            .select(restUserColumns)
            .from(schema.user)
            .where(inArray(schema.user.username, logins))
        : [],
      labelIds.length > 0
        ? this.db
            .select({ id: schema.label.id, numericId: schema.label.numericId })
            .from(schema.label)
            .where(inArray(schema.label.id, labelIds))
        : [],
    ]);
    const origins = githubOrigins(this.config);
    return {
      repository: {
        ownerLogin: repository.ownerLogin,
        apiUrl: `${origins.api}/api/v3/repos/${repository.nameWithOwner}`,
        webUrl: repository.url,
      },
      users: new Map(
        users.map((user) => [user.login, toUserRest(user, origins)]),
      ),
      labelIds: new Map(labels.map((label) => [label.id, label.numericId])),
    };
  }

  private async issueExtras(ids: string[]) {
    const rows =
      ids.length > 0
        ? await this.db
            .select({
              id: schema.issue.id,
              numericId: schema.issue.numericId,
              draft: schema.pullRequest.draft,
              mergedAt: schema.pullRequest.mergedAt,
            })
            .from(schema.issue)
            .leftJoin(
              schema.pullRequest,
              eq(schema.pullRequest.issueId, schema.issue.id),
            )
            .where(inArray(schema.issue.id, ids))
        : [];
    return new Map(rows.map(({ id, ...extras }) => [id, extras]));
  }
}
