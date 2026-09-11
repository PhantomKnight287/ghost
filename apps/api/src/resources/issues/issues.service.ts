import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { UserNotFoundError } from '../../services/users/users.errors.js';
import { decodeCursor, encodeCursor } from '../../utils/index.js';
import { InvalidCursorError } from '../repositories/repositories.errors.js';
import type { CreateIssueRequestDTO } from './dto/create-issue.dto.js';
import type { GetIssuesQueryDTO } from './dto/issue.dto.js';
import {
  IssueCommentNotFoundError,
  IssueNotFoundError,
  IssueNotOpenError,
  LabelAlreadyExistsError,
  LabelNotFoundError,
} from './issues.errors.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type Issue = typeof schema.issue.$inferSelect;
type IssueEventType = (typeof schema.issueEventType.enumValues)[number];

@Injectable()
export class IssuesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly access: RepositoryAccessService,
  ) {}

  async createIssue({
    username,
    repo,
    requesterId,
    body,
  }: {
    username: string;
    repo: string;
    requesterId: string;
    body: CreateIssueRequestDTO;
  }) {
    const repository = await this.authorize({ username, repo, requesterId });

    const labels = await this.resolveLabels(
      repository.id,
      dedupe(body.labels ?? []),
    );
    const assignees = await this.resolveUsers(dedupe(body.assignees ?? []));

    const values = {
      repositoryId: repository.id,
      title: body.title,
      body: body.body,
      authorId: requesterId,
      number: sql<number>`(select coalesce(max(${schema.issue.number}), 0) + 1 from ${schema.issue} where ${schema.issue.repositoryId} = ${repository.id})`,
    };

    // Two concurrent opens read the same max; the unique index rejects the
    // loser, whose retry then reads the winner's number. The whole open
    // (issue + opened event + labels + assignees) is one transaction so a
    // mid-way failure never leaves a partial issue behind.
    let created: Issue | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        created = await this.db.transaction(async (tx) => {
          const [row] = await tx.insert(schema.issue).values(values).returning();
          if (!row) throw new Error('Issue insert returned no rows');

          // The opening is the first timeline entry; labels and assignees follow.
          await this.recordEventWith(tx, row.id, requesterId, 'opened', {});

          if (labels.length > 0) {
            await tx.insert(schema.issueLabel).values(
              labels.map((label) => ({
                issueId: row.id,
                labelId: label.id,
              })),
            );
            for (const label of labels) {
              await this.recordEventWith(tx, row.id, requesterId, 'labeled', {
                labelName: label.name,
              });
            }
          }

          if (assignees.length > 0) {
            await tx.insert(schema.issueAssignee).values(
              assignees.map((user) => ({
                issueId: row.id,
                userId: user.id,
              })),
            );
            for (const user of assignees) {
              await this.recordEventWith(tx, row.id, requesterId, 'assigned', {
                assigneeUsername: user.username ?? '',
              });
            }
          }

          return row;
        });
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error;
      }
    }
    if (!created) throw new Error('Failed to create issue after retries');

    return this.toDTO(created, requesterId, repository.ownerId);
  }

  async getIssues({
    username,
    repo,
    requesterId,
    query,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
    query: GetIssuesQueryDTO;
  }) {
    const repository = await this.authorize({ username, repo, requesterId });

    const requested = Number(query.limit);
    const pageSize = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const state = query.state ?? 'open';
    const sort = query.sort ?? 'created';
    const direction = query.direction ?? 'desc';
    const orderFn = direction === 'asc' ? asc : desc;

    // `sort=comments` cursors carry a leading count (`count|iso|id`); every
    // other sort uses the shared keyset cursor (`iso|id`). Decoding with the
    // wrong one always fails, so pick by sort.
    const decoded =
      sort === 'comments'
        ? query.cursor
          ? decodeCommentCursor(query.cursor)
          : null
        : query.cursor
          ? decodeCursor(query.cursor)
          : null;
    if (query.cursor && !decoded) throw new InvalidCursorError();

    const labelNames = dedupe(
      (query.labels ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
    const labelFilterIds = await this.labelIdsForFilter(
      repository.id,
      labelNames,
    );
    if (labelNames.length > 0 && labelFilterIds === null) {
      return {
        issues: [],
        total: 0,
        openCount: 0,
        closedCount: 0,
        nextCursor: null,
        hasMore: false,
      };
    }

    const authorId = query.author
      ? await this.optionalUserId(query.author)
      : undefined;
    if (query.author && !authorId) {
      return {
        issues: [],
        total: 0,
        openCount: 0,
        closedCount: 0,
        nextCursor: null,
        hasMore: false,
      };
    }
    const assigneeId = query.assignee
      ? await this.optionalUserId(query.assignee)
      : undefined;
    if (query.assignee && !assigneeId) {
      return {
        issues: [],
        total: 0,
        openCount: 0,
        closedCount: 0,
        nextCursor: null,
        hasMore: false,
      };
    }

    // Label (AND) and assignee filters resolve to id sets first so the main
    // query stays a single indexed scan plus `inArray`. `const` (not `let`)
    // so the `baseClause` closure below keeps the narrowed type.
    const labelIssueIds: string[] | undefined =
      labelFilterIds && labelFilterIds.length > 0
        ? await this.issueIdsWithAllLabels(labelFilterIds)
        : undefined;
    if (labelIssueIds && labelIssueIds.length === 0) {
      return {
        issues: [],
        total: 0,
        openCount: 0,
        closedCount: 0,
        nextCursor: null,
        hasMore: false,
      };
    }
    const assigneeRows = assigneeId
      ? await this.db
          .select({ issueId: schema.issueAssignee.issueId })
          .from(schema.issueAssignee)
          .where(eq(schema.issueAssignee.userId, assigneeId))
      : null;
    const assigneeFilterIds: string[] | undefined = assigneeRows
      ? assigneeRows.map((row) => row.issueId)
      : undefined;
    if (assigneeFilterIds && assigneeFilterIds.length === 0) {
      return {
        issues: [],
        total: 0,
        openCount: 0,
        closedCount: 0,
        nextCursor: null,
        hasMore: false,
      };
    }

    const search = query.q?.trim();
    const searchClause = search
      ? or(
          ilike(schema.issue.title, `%${escapeLike(search)}%`),
          ilike(schema.issue.body, `%${escapeLike(search)}%`),
        )
      : undefined;

    const baseClause = (forState: 'open' | 'closed' | 'all') =>
      and(
        eq(schema.issue.repositoryId, repository.id),
        forState === 'all' ? undefined : eq(schema.issue.state, forState),
        authorId ? eq(schema.issue.authorId, authorId) : undefined,
        labelIssueIds ? inArray(schema.issue.id, labelIssueIds) : undefined,
        assigneeFilterIds
          ? inArray(schema.issue.id, assigneeFilterIds)
          : undefined,
        searchClause,
      );

    const cursorClause =
      decoded && sort !== 'comments'
        ? or(
            direction === 'desc'
              ? lt(sortColumn(sort), decoded.date)
              : gt(sortColumn(sort), decoded.date),
            and(
              eq(sortColumn(sort), decoded.date),
              direction === 'desc'
                ? lt(schema.issue.id, decoded.id)
                : gt(schema.issue.id, decoded.id),
            ),
          )
        : decoded && sort === 'comments' && isCommentsCursor(decoded)
          ? commentsCursorClause(decoded, direction)
          : undefined;

    const orderBy =
      sort === 'created'
        ? [orderFn(schema.issue.createdAt), orderFn(schema.issue.id)]
        : sort === 'updated'
          ? [orderFn(schema.issue.updatedAt), orderFn(schema.issue.id)]
          : [
              orderFn(schema.issue.commentCount),
              orderFn(schema.issue.createdAt),
              orderFn(schema.issue.id),
            ];

    const rows = await this.db
      .select()
      .from(schema.issue)
      .where(and(baseClause(state === 'all' ? 'all' : state), cursorClause))
      .orderBy(...orderBy)
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page.at(-1);

    const [[totalRow], [openRow], [closedRow]] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(schema.issue)
        .where(baseClause('all')),
      this.db
        .select({ total: count() })
        .from(schema.issue)
        .where(baseClause('open')),
      this.db
        .select({ total: count() })
        .from(schema.issue)
        .where(baseClause('closed')),
    ]);

    return {
      issues: await this.toDTOBatch(page, requesterId, repository.ownerId),
      total: totalRow?.total ?? 0,
      openCount: openRow?.total ?? 0,
      closedCount: closedRow?.total ?? 0,
      nextCursor:
        hasMore && last
          ? sort === 'comments'
            ? encodeCommentCursor({
                count: last.commentCount,
                date: last.createdAt,
                id: last.id,
              })
            : encodeCursor({ date: sortDateOf(sort, last), id: last.id })
          : null,
      hasMore,
    };
  }

  async getIssue(params: IssueRef) {
    const { issue, base } = await this.load(params);
    return this.toDTO(issue, params.requesterId, base.ownerId);
  }

  /** Title and body only — state moves through close/reopen. */
  async updateIssue(
    params: IssueRef & {
      requesterId: string;
      body: { title?: string; body?: string | null };
    },
  ) {
    const { issue, base } = await this.load(params);
    if (issue.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }

    const { title, body } = params.body;
    if (title === undefined && body === undefined) {
      return this.toDTO(issue, params.requesterId, base.ownerId);
    }

    const oldTitle = issue.title;
    const [updated] = await this.db
      .update(schema.issue)
      .set({
        ...(title === undefined ? {} : { title }),
        ...(body === undefined ? {} : { body }),
      })
      .where(eq(schema.issue.id, issue.id))
      .returning();
    if (!updated) throw new IssueNotFoundError();

    if (title !== undefined && title !== oldTitle) {
      await this.recordEvent(issue.id, params.requesterId, 'renamed', {
        oldTitle,
        newTitle: title,
      });
    }
    if (body !== undefined) {
      await this.recordEvent(issue.id, params.requesterId, 'edited', {});
    }

    return this.toDTO(updated, params.requesterId, base.ownerId);
  }

  async closeIssue(params: IssueRef & { requesterId: string }) {
    const { issue, base } = await this.load(params);
    if (issue.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }
    if (issue.state !== 'open') throw new IssueNotOpenError(issue.state);

    const [closed] = await this.db
      .update(schema.issue)
      .set({
        state: 'closed',
        closedAt: new Date(),
        closedById: params.requesterId,
      })
      .where(eq(schema.issue.id, issue.id))
      .returning();
    if (!closed) throw new IssueNotFoundError();

    await this.recordEvent(issue.id, params.requesterId, 'closed', {});
    return this.toDTO(closed, params.requesterId, base.ownerId);
  }

  async reopenIssue(params: IssueRef & { requesterId: string }) {
    const { issue, base } = await this.load(params);
    if (issue.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }
    if (issue.state !== 'closed') throw new IssueNotOpenError(issue.state);

    const [reopened] = await this.db
      .update(schema.issue)
      .set({ state: 'open', closedAt: null, closedById: null })
      .where(eq(schema.issue.id, issue.id))
      .returning();
    if (!reopened) throw new IssueNotFoundError();

    await this.recordEvent(issue.id, params.requesterId, 'reopened', {});
    return this.toDTO(reopened, params.requesterId, base.ownerId);
  }

  /**
   * Anyone who can read the issue can read its comments, and anyone who can
   * read it can add one — the same bar GitHub sets for a public repository.
   */
  async getComments(params: IssueRef) {
    const { issue } = await this.load(params);

    // ponytail: unpaginated, add a cursor if a thread ever outgrows one page
    const rows = await this.db
      .select({
        id: schema.issueComment.id,
        body: schema.issueComment.body,
        authorUsername: schema.user.username,
        createdAt: schema.issueComment.createdAt,
        updatedAt: schema.issueComment.updatedAt,
      })
      .from(schema.issueComment)
      .innerJoin(schema.user, eq(schema.user.id, schema.issueComment.authorId))
      .where(eq(schema.issueComment.issueId, issue.id))
      .orderBy(asc(schema.issueComment.createdAt), asc(schema.issueComment.id));

    return { comments: rows.map((row) => toCommentDTO(row)) };
  }

  async createComment(
    params: IssueRef & { requesterId: string; body: string },
  ) {
    const { issue } = await this.load(params);

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.issueComment)
        .values({
          issueId: issue.id,
          authorId: params.requesterId,
          body: params.body,
        })
        .returning();
      if (!row) throw new Error('Comment insert returned no rows');

      await tx
        .update(schema.issue)
        .set({
          commentCount: sql`${schema.issue.commentCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.issue.id, issue.id));

      return row;
    });

    const author = await this.users.getUserById(params.requesterId);
    return toCommentDTO({ ...created, authorUsername: author.username });
  }

  async updateComment(
    params: IssueRef & {
      requesterId: string;
      commentId: string;
      body: string;
    },
  ) {
    const { issue } = await this.load(params);
    const [comment] = await this.db
      .select()
      .from(schema.issueComment)
      .where(
        and(
          eq(schema.issueComment.id, params.commentId),
          eq(schema.issueComment.issueId, issue.id),
        ),
      );
    if (!comment) throw new IssueCommentNotFoundError();
    if (comment.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }

    const [updated] = await this.db
      .update(schema.issueComment)
      .set({ body: params.body })
      .where(eq(schema.issueComment.id, comment.id))
      .returning();
    if (!updated) throw new IssueCommentNotFoundError();

    await this.db
      .update(schema.issue)
      .set({ updatedAt: new Date() })
      .where(eq(schema.issue.id, issue.id));

    const author = await this.users.getUserById(updated.authorId);
    return toCommentDTO({ ...updated, authorUsername: author.username });
  }

  async deleteComment(
    params: IssueRef & { requesterId: string; commentId: string },
  ) {
    const { issue } = await this.load(params);
    const [comment] = await this.db
      .select()
      .from(schema.issueComment)
      .where(
        and(
          eq(schema.issueComment.id, params.commentId),
          eq(schema.issueComment.issueId, issue.id),
        ),
      );
    if (!comment) throw new IssueCommentNotFoundError();
    if (comment.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.issueComment)
        .where(eq(schema.issueComment.id, comment.id));
      await tx
        .update(schema.issue)
        .set({
          commentCount: sql`greatest(${schema.issue.commentCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(schema.issue.id, issue.id));
    });

    return { deleted: true };
  }

  async getTimeline(params: IssueRef) {
    const { issue } = await this.load(params);

    const [comments, events] = await Promise.all([
      this.db
        .select({
          id: schema.issueComment.id,
          body: schema.issueComment.body,
          authorUsername: schema.user.username,
          createdAt: schema.issueComment.createdAt,
          updatedAt: schema.issueComment.updatedAt,
        })
        .from(schema.issueComment)
        .innerJoin(
          schema.user,
          eq(schema.user.id, schema.issueComment.authorId),
        )
        .where(eq(schema.issueComment.issueId, issue.id))
        .orderBy(
          asc(schema.issueComment.createdAt),
          asc(schema.issueComment.id),
        ),
      this.db
        .select({
          id: schema.issueEvent.id,
          type: schema.issueEvent.type,
          actorUsername: schema.user.username,
          labelName: schema.issueEvent.labelName,
          assigneeUsername: schema.issueEvent.assigneeUsername,
          oldTitle: schema.issueEvent.oldTitle,
          newTitle: schema.issueEvent.newTitle,
          createdAt: schema.issueEvent.createdAt,
        })
        .from(schema.issueEvent)
        .leftJoin(schema.user, eq(schema.user.id, schema.issueEvent.actorId))
        .where(eq(schema.issueEvent.issueId, issue.id))
        .orderBy(asc(schema.issueEvent.createdAt), asc(schema.issueEvent.id)),
    ]);

    const timeline: Array<
      | {
          kind: 'comment';
          id: string;
          body: string;
          authorUsername: string;
          createdAt: string;
          updatedAt: string;
        }
      | {
          kind: 'event';
          event: {
            id: string;
            type: IssueEventType;
            actorUsername: string;
            labelName: string | null;
            assigneeUsername: string | null;
            oldTitle: string | null;
            newTitle: string | null;
            createdAt: string;
          };
          createdAt: string;
        }
    > = [
      ...comments.map((comment) => ({
        kind: 'comment' as const,
        id: comment.id,
        body: comment.body,
        authorUsername: comment.authorUsername ?? '',
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
      })),
      ...events.map((event) => ({
        kind: 'event' as const,
        event: {
          id: event.id,
          type: event.type,
          actorUsername: event.actorUsername ?? '',
          labelName: event.labelName,
          assigneeUsername: event.assigneeUsername,
          oldTitle: event.oldTitle,
          newTitle: event.newTitle,
          createdAt: event.createdAt.toISOString(),
        },
        createdAt: event.createdAt.toISOString(),
      })),
    ].sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      const aId = a.kind === 'comment' ? a.id : a.event.id;
      const bId = b.kind === 'comment' ? b.id : b.event.id;
      if (aId < bId) return -1;
      if (aId > bId) return 1;
      return 0;
    });

    return { timeline };
  }

  // Labels — repository scoped, like GitHub.

  async listLabels(params: {
    username: string;
    repo: string;
    requesterId?: string;
  }) {
    const repository = await this.authorize(params);
    const rows = await this.db
      .select()
      .from(schema.label)
      .where(eq(schema.label.repositoryId, repository.id))
      .orderBy(asc(schema.label.name));
    return { labels: rows.map(toLabelDTO) };
  }

  async createLabel(params: {
    username: string;
    repo: string;
    requesterId: string;
    body: { name: string; description?: string; color: string };
  }) {
    const repository = await this.authorize({ ...params, operation: 'write' });
    const name = params.body.name.trim();
    const [existing] = await this.db
      .select({ id: schema.label.id })
      .from(schema.label)
      .where(
        and(
          eq(schema.label.repositoryId, repository.id),
          eq(schema.label.name, name),
        ),
      );
    if (existing) throw new LabelAlreadyExistsError(name);

    const [created] = await this.db
      .insert(schema.label)
      .values({
        repositoryId: repository.id,
        name,
        description: params.body.description,
        color: params.body.color.toLowerCase(),
      })
      .returning();
    return toLabelDTO(created);
  }

  async updateLabel(params: {
    username: string;
    repo: string;
    requesterId: string;
    labelId: string;
    body: { name?: string; description?: string | null; color?: string };
  }) {
    const repository = await this.authorize({ ...params, operation: 'write' });
    const [label] = await this.db
      .select()
      .from(schema.label)
      .where(
        and(
          eq(schema.label.id, params.labelId),
          eq(schema.label.repositoryId, repository.id),
        ),
      );
    if (!label) throw new LabelNotFoundError(params.labelId);

    if (params.body.name && params.body.name.trim() !== label.name) {
      const [clash] = await this.db
        .select({ id: schema.label.id })
        .from(schema.label)
        .where(
          and(
            eq(schema.label.repositoryId, repository.id),
            eq(schema.label.name, params.body.name.trim()),
          ),
        );
      if (clash) throw new LabelAlreadyExistsError(params.body.name.trim());
    }

    const [updated] = await this.db
      .update(schema.label)
      .set({
        ...(params.body.name === undefined
          ? {}
          : { name: params.body.name.trim() }),
        ...(params.body.description === undefined
          ? {}
          : { description: params.body.description }),
        ...(params.body.color === undefined
          ? {}
          : { color: params.body.color.toLowerCase() }),
      })
      .where(eq(schema.label.id, label.id))
      .returning();
    return toLabelDTO(updated);
  }

  async deleteLabel(params: {
    username: string;
    repo: string;
    requesterId: string;
    labelId: string;
  }) {
    const repository = await this.authorize({ ...params, operation: 'write' });
    const [label] = await this.db
      .select()
      .from(schema.label)
      .where(
        and(
          eq(schema.label.id, params.labelId),
          eq(schema.label.repositoryId, repository.id),
        ),
      );
    if (!label) throw new LabelNotFoundError(params.labelId);
    await this.db.delete(schema.label).where(eq(schema.label.id, label.id));
    return { deleted: true };
  }

  /** Full replacement of an issue's label set, like GitHub's sidebar. */
  async setIssueLabels(
    params: IssueRef & { requesterId: string; names: string[] },
  ) {
    const { issue, base } = await this.load(params);
    if (issue.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }

    const names = dedupe(
      params.names.map((name) => name.trim()).filter(Boolean),
    );
    const labels = await this.resolveLabels(base.id, names);

    const current = await this.db
      .select({ labelId: schema.issueLabel.labelId })
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, issue.id));
    const currentIds = new Set(current.map((row) => row.labelId));
    const nextIds = new Set(labels.map((label) => label.id));

    const added = labels.filter((label) => !currentIds.has(label.id));
    const removedIds = [...currentIds].filter((id) => !nextIds.has(id));
    const removed =
      removedIds.length > 0
        ? await this.db
            .select()
            .from(schema.label)
            .where(inArray(schema.label.id, removedIds))
        : [];

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.issueLabel)
        .where(eq(schema.issueLabel.issueId, issue.id));
      if (labels.length > 0) {
        await tx
          .insert(schema.issueLabel)
          .values(
            labels.map((label) => ({ issueId: issue.id, labelId: label.id })),
          );
      }

      for (const label of removed) {
        await this.recordEventWith(tx, issue.id, params.requesterId, 'unlabeled', {
          labelName: label.name,
        });
      }
      for (const label of added) {
        await this.recordEventWith(tx, issue.id, params.requesterId, 'labeled', {
          labelName: label.name,
        });
      }

      if (added.length > 0 || removed.length > 0) {
        await tx
          .update(schema.issue)
          .set({ updatedAt: new Date() })
          .where(eq(schema.issue.id, issue.id));
      }
    });

    return { labels: labels.map(toLabelDTO) };
  }

  /** Full replacement of an issue's assignee set, like GitHub's sidebar. */
  async setIssueAssignees(
    params: IssueRef & { requesterId: string; usernames: string[] },
  ) {
    const { issue } = await this.load(params);
    if (issue.authorId !== params.requesterId) {
      await this.authorize({ ...params, operation: 'write' });
    }

    const usernames = dedupe(
      params.usernames.map((name) => name.trim()).filter(Boolean),
    );
    const users = await this.resolveUsers(usernames);

    const current = await this.db
      .select({ userId: schema.issueAssignee.userId })
      .from(schema.issueAssignee)
      .where(eq(schema.issueAssignee.issueId, issue.id));
    const currentIds = new Set(current.map((row) => row.userId));
    const nextIds = new Set(users.map((user) => user.id));

    const added = users.filter((user) => !currentIds.has(user.id));
    const removedIds = [...currentIds].filter((id) => !nextIds.has(id));
    const removed =
      removedIds.length > 0
        ? await this.db
            .select()
            .from(schema.user)
            .where(inArray(schema.user.id, removedIds))
        : [];

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.issueAssignee)
        .where(eq(schema.issueAssignee.issueId, issue.id));
      if (users.length > 0) {
        await tx
          .insert(schema.issueAssignee)
          .values(users.map((user) => ({ issueId: issue.id, userId: user.id })));
      }

      for (const user of removed) {
        await this.recordEventWith(tx, issue.id, params.requesterId, 'unassigned', {
          assigneeUsername: user.username ?? '',
        });
      }
      for (const user of added) {
        await this.recordEventWith(tx, issue.id, params.requesterId, 'assigned', {
          assigneeUsername: user.username ?? '',
        });
      }

      if (added.length > 0 || removed.length > 0) {
        await tx
          .update(schema.issue)
          .set({ updatedAt: new Date() })
          .where(eq(schema.issue.id, issue.id));
      }
    });

    return { assignees: users.map((user) => user.username ?? '') };
  }

  private async load({
    username,
    repo,
    number,
    requesterId,
    operation,
  }: IssueRef) {
    const base = await this.authorize({
      username,
      repo,
      requesterId,
      operation,
    });
    const [issue] = await this.db
      .select()
      .from(schema.issue)
      .where(
        and(
          eq(schema.issue.repositoryId, base.id),
          eq(schema.issue.number, number),
        ),
      );
    if (!issue) throw new IssueNotFoundError();

    return { issue, base };
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

  private async toDTO(issueRow: Issue, requesterId?: string, ownerId?: string) {
    const [author, labels, assignees, closer] = await Promise.all([
      this.users.getUserById(issueRow.authorId),
      this.db
        .select({
          id: schema.label.id,
          name: schema.label.name,
          description: schema.label.description,
          color: schema.label.color,
          createdAt: schema.label.createdAt,
          updatedAt: schema.label.updatedAt,
        })
        .from(schema.issueLabel)
        .innerJoin(schema.label, eq(schema.label.id, schema.issueLabel.labelId))
        .where(eq(schema.issueLabel.issueId, issueRow.id)),
      this.db
        .select({ username: schema.user.username })
        .from(schema.issueAssignee)
        .innerJoin(schema.user, eq(schema.user.id, schema.issueAssignee.userId))
        .where(eq(schema.issueAssignee.issueId, issueRow.id)),
      issueRow.closedById
        ? this.users.getUserById(issueRow.closedById).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      id: issueRow.id,
      number: issueRow.number,
      title: issueRow.title,
      body: issueRow.body,
      state: issueRow.state,
      authorUsername: author.username ?? '',
      closedByUsername: closer?.username ?? null,
      labels: labels.map(toLabelDTO),
      assignees: assignees.map((row) => row.username ?? ''),
      commentCount: issueRow.commentCount,
      closedAt: issueRow.closedAt?.toISOString() ?? null,
      createdAt: issueRow.createdAt.toISOString(),
      updatedAt: issueRow.updatedAt.toISOString(),
      viewerCanEdit: canEditIssue(issueRow, requesterId, ownerId),
    };
  }

  private async toDTOBatch(
    rows: Issue[],
    requesterId?: string,
    ownerId?: string,
  ) {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const authorIds = [...new Set(rows.map((row) => row.authorId))];
    const closerIds = [
      ...new Set(
        rows.map((row) => row.closedById).filter((id): id is string => !!id),
      ),
    ];

    const [authors, closers, labelRows, assigneeRows] = await Promise.all([
      this.db
        .select({ id: schema.user.id, username: schema.user.username })
        .from(schema.user)
        .where(inArray(schema.user.id, authorIds)),
      closerIds.length > 0
        ? this.db
            .select({ id: schema.user.id, username: schema.user.username })
            .from(schema.user)
            .where(inArray(schema.user.id, closerIds))
        : Promise.resolve([] as Array<{ id: string; username: string | null }>),
      this.db
        .select({
          issueId: schema.issueLabel.issueId,
          id: schema.label.id,
          name: schema.label.name,
          description: schema.label.description,
          color: schema.label.color,
          createdAt: schema.label.createdAt,
          updatedAt: schema.label.updatedAt,
        })
        .from(schema.issueLabel)
        .innerJoin(schema.label, eq(schema.label.id, schema.issueLabel.labelId))
        .where(inArray(schema.issueLabel.issueId, ids)),
      this.db
        .select({
          issueId: schema.issueAssignee.issueId,
          username: schema.user.username,
        })
        .from(schema.issueAssignee)
        .innerJoin(schema.user, eq(schema.user.id, schema.issueAssignee.userId))
        .where(inArray(schema.issueAssignee.issueId, ids)),
    ]);

    const authorById = new Map(authors.map((u) => [u.id, u.username ?? '']));
    const closerById = new Map(closers.map((u) => [u.id, u.username ?? null]));
    const labelsByIssue = new Map<string, typeof labelRows>();
    for (const row of labelRows) {
      const list = labelsByIssue.get(row.issueId) ?? [];
      list.push(row);
      labelsByIssue.set(row.issueId, list);
    }
    const assigneesByIssue = new Map<string, string[]>();
    for (const row of assigneeRows) {
      const list = assigneesByIssue.get(row.issueId) ?? [];
      list.push(row.username ?? '');
      assigneesByIssue.set(row.issueId, list);
    }

    return rows.map((issueRow) => ({
      id: issueRow.id,
      number: issueRow.number,
      title: issueRow.title,
      body: issueRow.body,
      state: issueRow.state,
      authorUsername: authorById.get(issueRow.authorId) ?? '',
      closedByUsername: issueRow.closedById
        ? (closerById.get(issueRow.closedById) ?? null)
        : null,
      labels: (labelsByIssue.get(issueRow.id) ?? []).map(toLabelDTO),
      assignees: assigneesByIssue.get(issueRow.id) ?? [],
      commentCount: issueRow.commentCount,
      closedAt: issueRow.closedAt?.toISOString() ?? null,
      createdAt: issueRow.createdAt.toISOString(),
      updatedAt: issueRow.updatedAt.toISOString(),
      viewerCanEdit: canEditIssue(issueRow, requesterId, ownerId),
    }));
  }

  private async recordEvent(
    issueId: string,
    actorId: string,
    type: IssueEventType,
    extra: {
      labelName?: string;
      assigneeUsername?: string;
      oldTitle?: string;
      newTitle?: string;
    },
  ) {
    await this.recordEventWith(this.db, issueId, actorId, type, extra);
  }

  private async recordEventWith(
    db: Pick<Database, 'insert'>,
    issueId: string,
    actorId: string,
    type: IssueEventType,
    extra: {
      labelName?: string;
      assigneeUsername?: string;
      oldTitle?: string;
      newTitle?: string;
    },
  ) {
    await db.insert(schema.issueEvent).values({
      issueId,
      actorId,
      type,
      ...extra,
    });
  }

  private async resolveLabels(repositoryId: string, names: string[]) {
    if (names.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.label)
      .where(
        and(
          eq(schema.label.repositoryId, repositoryId),
          inArray(schema.label.name, names),
        ),
      );
    const found = new Set(rows.map((row) => row.name));
    const missing = names.find((name) => !found.has(name));
    if (missing) throw new LabelNotFoundError(missing);
    return rows;
  }

  private async labelIdsForFilter(repositoryId: string, names: string[]) {
    if (names.length === 0) return [];
    const rows = await this.db
      .select({ id: schema.label.id, name: schema.label.name })
      .from(schema.label)
      .where(
        and(
          eq(schema.label.repositoryId, repositoryId),
          inArray(schema.label.name, names),
        ),
      );
    if (rows.length !== names.length) return null;
    return rows.map((row) => row.id);
  }

  private async issueIdsWithAllLabels(labelIds: string[]) {
    const rows = await this.db
      .select({
        issueId: schema.issueLabel.issueId,
        matched: sql<number>`count(distinct ${schema.issueLabel.labelId})`,
      })
      .from(schema.issueLabel)
      .where(inArray(schema.issueLabel.labelId, labelIds))
      .groupBy(schema.issueLabel.issueId)
      .having(
        sql`count(distinct ${schema.issueLabel.labelId}) = ${labelIds.length}`,
      );
    return rows.map((row) => row.issueId);
  }

  private async resolveUsers(usernames: string[]) {
    if (usernames.length === 0) return [];
    return Promise.all(
      usernames.map((username) =>
        this.users.getUserByUsername(username).catch((error) => {
          // Preserve first-failure semantics: unknown users surface as
          // UserNotFoundError, anything else rethrows.
          throw error;
        }),
      ),
    );
  }

  private async optionalUserId(username: string) {
    try {
      return (await this.users.getUserByUsername(username)).id;
    } catch (error) {
      if (error instanceof UserNotFoundError) return null;
      throw error;
    }
  }
}

interface IssueRef {
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

function dedupe(names: string[]) {
  return [...new Set(names)];
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function sortColumn(sort: 'created' | 'updated' | 'comments') {
  return sort === 'updated' ? schema.issue.updatedAt : schema.issue.createdAt;
}

function sortDateOf(sort: 'created' | 'updated' | 'comments', row: Issue) {
  return sort === 'updated' ? row.updatedAt : row.createdAt;
}

function toLabelDTO(row: {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCommentDTO(row: {
  id: string;
  body: string;
  authorUsername: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    body: row.body,
    authorUsername: row.authorUsername ?? '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function encodeCommentCursor({
  count,
  date,
  id,
}: {
  count: number;
  date: Date;
  id: string;
}) {
  return Buffer.from(`${count}|${date.toISOString()}|${id}`).toString(
    'base64url',
  );
}

function decodeCommentCursor(cursor: string) {
  try {
    const [countRaw, timestamp, id] = Buffer.from(cursor, 'base64url')
      .toString('utf8')
      .split('|');
    if (!countRaw || !timestamp || !id) return null;
    const count = Number(countRaw);
    const date = new Date(timestamp);
    if (!Number.isFinite(count) || Number.isNaN(date.getTime())) return null;
    return { count, date, id };
  } catch {
    return null;
  }
}

type CommentsCursor = { count: number; date: Date; id: string };

function isCommentsCursor(
  decoded: { date: Date; id: string } | CommentsCursor,
): decoded is CommentsCursor {
  return 'count' in decoded;
}

function commentsCursorClause(
  decoded: CommentsCursor,
  direction: 'asc' | 'desc',
) {
  const commentCountCol = sql<number>`${schema.issue.commentCount}`;
  if (direction === 'desc') {
    return or(
      lt(schema.issue.commentCount, decoded.count),
      and(
        eq(schema.issue.commentCount, decoded.count),
        or(
          lt(schema.issue.createdAt, decoded.date),
          and(
            eq(schema.issue.createdAt, decoded.date),
            lt(schema.issue.id, decoded.id),
          ),
        ),
      ),
    );
  }
  return or(
    sql`${commentCountCol} > ${decoded.count}`,
    and(
      eq(schema.issue.commentCount, decoded.count),
      or(
        sql`${schema.issue.createdAt} > ${decoded.date}`,
        and(
          eq(schema.issue.createdAt, decoded.date),
          sql`${schema.issue.id} > ${decoded.id}`,
        ),
      ),
    ),
  );
}

function canEditIssue(
  issueRow: Issue,
  requesterId?: string,
  ownerId?: string,
) {
  if (!requesterId) return false;
  return requesterId === issueRow.authorId || requesterId === ownerId;
}
