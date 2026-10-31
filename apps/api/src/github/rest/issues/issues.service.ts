import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

import { viaAppOf } from '../../../lib/apps/via-app.js';
import { DATABASE } from '../../../database/database.module.js';
import { isoTimestamp, sameName } from '../../../lib/db/sql.js';
import {
  GithubNotFoundError,
  GithubValidationError,
  RequiresAuthenticationError,
} from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { WRITE_OR_ABOVE } from '../../../lib/github/permission.js';
import {
  type IssueExtras,
  labelNamesOf,
  pageOf,
  type RestCommentSource,
  type RestContext,
  RestPage,
  toCommentRest,
  toIssueRest,
  toLabelRest,
  toUserRest,
} from '../../../lib/github/rest.js';
import { UserNotFoundError } from '../../../lib/users/users.errors.js';
import type { IssueDTO } from '../../../resources/issues/dto/issue.dto.js';
import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import { requireWriteScope } from '../../auth/require-scopes.js';
import { RepositoryPermission } from '../../graphql/enums.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type {
  GithubCreateIssueDTO,
  GithubListIssuesQueryDTO,
  GithubPageQueryDTO,
  GithubUpdateIssueDTO,
} from './dto/issue.dto.js';

const TRIAGE_OR_ABOVE: (RepositoryPermission | null)[] = [
  RepositoryPermission.ADMIN,
  RepositoryPermission.MAINTAIN,
  RepositoryPermission.WRITE,
  RepositoryPermission.TRIAGE,
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
    private readonly repositories: RepositoryNodesService,
    private readonly config: ConfigService,
  ) {}

  async listIssues(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubListIssuesQueryDTO,
  ) {
    const repository = await this.readable(owner, repo, viewer);
    const page = pageOf(query);
    const state = query.state ?? 'open';
    const anyOrNone = query.assignee === '*' || query.assignee === 'none';
    const list = await this.issueService.getIssues(
      {
        ...this.ref(repository, viewer),
        query: {
          state,
          labels: query.labels,
          author: query.creator,
          assignee: anyOrNone ? undefined : query.assignee,
          sort: query.sort,
          direction: query.direction,
          limit: page.perPage,
        },
      },
      {
        offset: page.offset,
        includePullRequests: true,
        since: query.since ? new Date(query.since) : undefined,
        assigned: anyOrNone ? query.assignee === '*' : undefined,
      },
    );
    return new RestPage(
      await this.issues(repository, list.issues),
      page,
      state === 'open'
        ? list.openCount
        : state === 'closed'
          ? list.closedCount
          : list.total,
    );
  }

  /** Labels and assignees from someone who cannot triage are dropped, as on GitHub. */
  async createIssue(
    { owner, repo, viewer }: GithubRepositoryTarget,
    body: GithubCreateIssueDTO,
  ) {
    const { repository, viewer: signedIn } = await this.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/issues',
    );
    if (body.milestone !== undefined && body.milestone !== null)
      throw new GithubValidationError([
        { resource: 'Issue', field: 'milestone', code: 'invalid' },
      ]);
    const triage = this.canTriage(repository);
    const labels =
      triage && body.labels !== undefined ? labelNamesOf(body.labels) : [];
    await this.ensureLabels(repository, signedIn, labels);
    const created = await this.assigning(() =>
      this.issueService.createIssue({
        username: repository.ownerLogin,
        repo: repository.slug,
        requesterId: signedIn.userId,
        body: {
          title: body.title,
          body: body.body ?? undefined,
          labels,
          assignees: triage
            ? [
                ...(body.assignees ?? []),
                ...(body.assignee ? [body.assignee] : []),
              ]
            : [],
        },
      }),
    );
    return this.issue(repository, created);
  }

  async getIssue(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
  ) {
    const repository = await this.readable(owner, repo, viewer);
    return this.issue(
      repository,
      await this.issueService.getIssue({
        ...this.ref(repository, viewer),
        number,
      }),
    );
  }

  async updateIssue(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubUpdateIssueDTO,
  ) {
    const { repository, viewer: signedIn } = await this.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/issues/:number',
    );
    if (body.milestone !== undefined && body.milestone !== null)
      throw new GithubValidationError([
        { resource: 'Issue', field: 'milestone', code: 'invalid' },
      ]);
    const ref = {
      ...this.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const current = await this.issueService.getIssue(ref);
    const triage = this.canTriage(repository);
    const labels =
      triage && body.labels !== undefined ? labelNamesOf(body.labels) : null;
    if (body.title !== undefined || body.body !== undefined)
      await this.issueService.updateIssue({
        ...ref,
        body: { title: body.title, body: body.body },
      });
    // Closing a closed issue is a no-op on GitHub; Ghost refuses it.
    if (body.state === 'closed' && current.state === 'open')
      await this.issueService.closeIssue(ref);
    if (body.state === 'open' && current.state === 'closed')
      await this.issueService.reopenIssue(ref);
    if (labels) {
      await this.ensureLabels(repository, signedIn, labels);
      await this.issueService.setIssueLabels({ ...ref, names: labels });
    }
    if (triage && (body.assignees !== undefined || body.assignee !== undefined))
      await this.assigning(() =>
        this.issueService.setIssueAssignees({
          ...ref,
          usernames: [
            ...(body.assignees ?? []),
            ...(body.assignee ? [body.assignee] : []),
          ],
        }),
      );
    return this.issue(repository, await this.issueService.getIssue(ref));
  }

  addAssignees(
    target: GithubRepositoryTarget,
    number: number,
    logins: string[],
  ) {
    return this.changeAssignees(
      target,
      number,
      'POST /repos/:owner/:repo/issues/:number/assignees',
      (current) => [...current, ...logins],
    );
  }

  removeAssignees(
    target: GithubRepositoryTarget,
    number: number,
    logins: string[],
  ) {
    return this.changeAssignees(
      target,
      number,
      'DELETE /repos/:owner/:repo/issues/:number/assignees',
      (current) => current.filter((login) => !logins.includes(login)),
    );
  }

  /** Add and remove are a read, then a full replacement through IssuesService. */
  private async changeAssignees(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    route: string,
    next: (current: string[]) => string[],
  ) {
    const { repository, viewer: signedIn } = await this.writable(
      owner,
      repo,
      viewer,
      route,
    );
    const ref = {
      ...this.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const current = await this.issueService.getIssue(ref);
    // ponytail: read then replace; two concurrent adds can lose one. Add IssuesService.addIssueAssignees if that bites.
    if (this.canTriage(repository))
      await this.assigning(() =>
        this.issueService.setIssueAssignees({
          ...ref,
          usernames: next(current.assignees),
        }),
      );
    return this.issue(repository, await this.issueService.getIssue(ref));
  }

  async canBeAssignedToIssue(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    assignee: string,
  ) {
    const repository = await this.readable(owner, repo, viewer);
    await this.issueService.getIssue({
      ...this.ref(repository, viewer),
      number,
    });
    await this.requireUser(assignee);
  }

  async canBeAssigned(
    { owner, repo, viewer }: GithubRepositoryTarget,
    assignee: string,
  ) {
    await this.readable(owner, repo, viewer);
    await this.requireUser(assignee);
  }

  /** People with access to the repository: its owner, accepted collaborators and organization members. */
  async listAssignees(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.readable(owner, repo, viewer);
    const page = pageOf(query);
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
    return new RestPage(
      users.map((user) => toUserRest(user, origins)),
      page,
      total?.total ?? 0,
    );
  }

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
        viaApp: viaAppOf(schema.issueComment.viaAppId),
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
    if (!comment) throw new GithubNotFoundError();
    return comment;
  }

  /** 404 unless `login` names a user; Ghost lets any user be assigned. */
  async requireUser(login: string) {
    const [user] = await this.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sameName(schema.user.username, login));
    if (!user) throw new GithubNotFoundError();
  }

  async labelByName(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    name: string,
  ) {
    const { labels } = await this.issueService.listLabels(
      this.ref(repository, viewer),
    );
    const label = labels.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    if (!label) throw new GithubNotFoundError();
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
    const existing = new Set(labels.map((label) => label.name.toLowerCase()));
    const missing: string[] = [];
    for (const name of names.map((name) => name.trim()).filter(Boolean)) {
      if (existing.has(name.toLowerCase())) continue;
      existing.add(name.toLowerCase());
      missing.push(name);
    }
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

  /** The users and label ids the responses for `related` embed, loaded once. */
  async context(
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

  async issueExtras(ids: string[]) {
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
