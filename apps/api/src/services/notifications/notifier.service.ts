import { type Database, schema } from '@ghost/db';
import { parseReferences } from '@ghost/references';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { RepositoryEvent, StoredEvent } from '../../lib/events/events.js';
import { ownerNameOf } from '../../lib/git/repository-access/repository-access.js';
import { teamSlug } from '../../lib/organizations/team-slug.js';
import { MailService, type ThreadTemplate } from '../../mail/mail.service.js';
import type { NotificationReason } from '../../mail/components/thread.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';
import { excluded } from '../../utils/index.js';

// Long enough to read the point of a comment in the email, short enough that nobody reads a whole essay there.
const EXCERPT_LENGTH = 1000;

// GitHub's limit too: one comment cannot page a whole user base.
const MAX_MENTIONS = 50;

const STATES = {
  'issue.closed': 'closed',
  'issue.reopened': 'reopened',
  'pull_request.merged': 'merged',
} as const;

type Thread = NonNullable<Awaited<ReturnType<NotifierService['loadThread']>>>;

/** What an event says, as far as notifications care. */
type Activity = {
  /** Text whose `@user` and `@org/team` mentions notify, and subscribe, whoever they name. */
  text: string | null;
  assigneeIds: string[];
  /** Whether the actor joined the conversation, and so subscribes to it. */
  participates: boolean;
  template: ThreadTemplate;
  context: Record<string, unknown>;
};

/** Turns repository events into inbox rows and emails. */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly mail: MailService,
  ) {}

  async handle(event: StoredEvent) {
    const thread = await this.loadThread(event.payload.issueId);
    if (!thread) return;
    const activity = await this.activityOf(event, thread);
    if (!activity) return;

    const recipients = await this.recipientsOf(event, thread, activity);
    if (recipients.size === 0) return;

    await this.db
      .insert(schema.notification)
      .values(
        [...recipients].map(([userId, reason]) => ({
          userId,
          issueId: thread.id,
          reason,
          eventType: event.type,
          actorId: event.actorId,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.notification.userId, schema.notification.issueId],
        set: {
          reason: excluded(schema.notification.reason),
          eventType: excluded(schema.notification.eventType),
          actorId: excluded(schema.notification.actorId),
          unread: true,
          updatedAt: sql`now()`,
        },
      });

    await this.email(event, thread, activity, recipients);
  }

  private async loadThread(issueId: string) {
    const [thread] = await this.db
      .select({
        id: schema.issue.id,
        number: schema.issue.number,
        title: schema.issue.title,
        body: schema.issue.body,
        isPullRequest: schema.issue.isPullRequest,
        authorId: schema.issue.authorId,
        repositoryId: schema.issue.repositoryId,
        organizationId: schema.repository.organizationId,
        repository: sql<string>`${ownerNameOf(schema.user, schema.organization)} || '/' || ${schema.repository.slug}`,
      })
      .from(schema.issue)
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.issue.repositoryId),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.issue.id, issueId));
    return thread;
  }

  /** Null when what the event points at is gone, such as a comment deleted before its event was handled. */
  private async activityOf(
    event: RepositoryEvent,
    thread: Thread,
  ): Promise<Activity | null> {
    switch (event.type) {
      case 'issue.opened': {
        const assignees = await this.db
          .select({ userId: schema.issueAssignee.userId })
          .from(schema.issueAssignee)
          .where(eq(schema.issueAssignee.issueId, thread.id));
        return {
          text: thread.body,
          assigneeIds: assignees.map((row) => row.userId),
          participates: true,
          template: 'thread-opened',
          context: { body: thread.body && excerpt(thread.body) },
        };
      }
      case 'issue.commented': {
        const [comment] = await this.db
          .select({ body: schema.issueComment.body })
          .from(schema.issueComment)
          .where(eq(schema.issueComment.id, event.payload.commentId));
        if (!comment) return null;
        return {
          text: comment.body,
          assigneeIds: [],
          participates: true,
          template: 'thread-comment',
          context: { body: excerpt(comment.body), file: null },
        };
      }
      case 'pull_request.review_commented': {
        const [comment] = await this.db
          .select({
            body: schema.pullRequestReviewComment.body,
            path: schema.pullRequestReviewComment.path,
          })
          .from(schema.pullRequestReviewComment)
          .where(
            eq(schema.pullRequestReviewComment.id, event.payload.commentId),
          );
        if (!comment) return null;
        return {
          text: comment.body,
          assigneeIds: [],
          participates: true,
          template: 'thread-comment',
          context: { body: excerpt(comment.body), file: comment.path },
        };
      }
      case 'pull_request.reviewed': {
        const [review] = await this.db
          .select({
            state: schema.pullRequestReview.state,
            body: schema.pullRequestReview.body,
          })
          .from(schema.pullRequestReview)
          .where(eq(schema.pullRequestReview.id, event.payload.reviewId));
        if (!review) return null;
        const comments = await this.db
          .select({ body: schema.pullRequestReviewComment.body })
          .from(schema.pullRequestReviewComment)
          .where(
            eq(
              schema.pullRequestReviewComment.reviewId,
              event.payload.reviewId,
            ),
          );
        return {
          text: [review.body, ...comments.map((comment) => comment.body)].join(
            '\n\n',
          ),
          assigneeIds: [],
          participates: true,
          template: 'thread-review',
          context: {
            state: review.state,
            body: review.body && excerpt(review.body),
            commentCount: comments.length,
          },
        };
      }
      case 'issue.assigned': {
        const [assignee] = await this.db
          .select({ username: schema.user.username })
          .from(schema.user)
          .where(eq(schema.user.id, event.payload.assigneeId));
        if (!assignee) return null;
        return {
          text: null,
          assigneeIds: [event.payload.assigneeId],
          participates: false,
          template: 'thread-assigned',
          context: { assignee: assignee.username },
        };
      }
      case 'issue.closed':
      case 'issue.reopened':
      case 'pull_request.merged':
        return {
          text: null,
          assigneeIds: [],
          participates: false,
          template: 'thread-state',
          context: { state: STATES[event.type] },
        };
    }
  }

  /** Everyone to notify, each with the most specific reason that applies. Nobody hears about their own activity, or about a repository they ignore or can no longer read. */
  private async recipientsOf(
    event: RepositoryEvent,
    thread: Thread,
    activity: Activity,
  ) {
    const direct = new Map<string, NotificationReason>();
    for (const userId of activity.assigneeIds) direct.set(userId, 'assigned');
    const mentions = await this.mentionsIn(
      activity.text,
      thread,
      event.actorId,
    );
    for (const userId of mentions.users) {
      if (!direct.has(userId)) direct.set(userId, 'mentioned');
    }
    for (const userId of mentions.teams) {
      if (!direct.has(userId)) direct.set(userId, 'team_mentioned');
    }
    // mentioning someone who cannot read the thread must neither notify nor subscribe them
    for (const userId of direct.keys()) {
      if (!(await this.access.canRead(thread.repositoryId, userId))) {
        direct.delete(userId);
      }
    }

    const joining = [...direct.keys()];
    if (activity.participates && event.actorId) joining.push(event.actorId);
    if (joining.length > 0) {
      await this.db
        .insert(schema.issueSubscription)
        .values(
          joining.map((userId) => ({
            userId,
            issueId: thread.id,
            subscribed: true,
          })),
        )
        .onConflictDoNothing();
    }

    const [subscriptions, watches] = await Promise.all([
      this.db
        .select({
          userId: schema.issueSubscription.userId,
          subscribed: schema.issueSubscription.subscribed,
        })
        .from(schema.issueSubscription)
        .where(eq(schema.issueSubscription.issueId, thread.id)),
      this.db
        .select({
          userId: schema.repositoryWatch.userId,
          level: schema.repositoryWatch.level,
        })
        .from(schema.repositoryWatch)
        .where(eq(schema.repositoryWatch.repositoryId, thread.repositoryId)),
    ]);

    const subscribed = new Map(
      subscriptions.map((row) => [row.userId, row.subscribed]),
    );
    const ignoring = new Set(
      watches.filter((row) => row.level === 'ignore').map((row) => row.userId),
    );
    const indirect = new Map<string, NotificationReason>();
    for (const [userId, isSubscribed] of subscribed) {
      if (isSubscribed) {
        indirect.set(
          userId,
          userId === thread.authorId ? 'author' : 'subscribed',
        );
      }
    }
    for (const { userId, level } of watches) {
      // an explicit unsubscribe silences watching too
      if (level === 'all' && !subscribed.has(userId))
        indirect.set(userId, 'watching');
    }

    const recipients = new Map(direct);
    // ponytail: one access query per indirect recipient, batch them if threads with hundreds of subscribers show up
    for (const [userId, reason] of indirect) {
      if (
        !recipients.has(userId) &&
        (await this.access.canRead(thread.repositoryId, userId))
      ) {
        recipients.set(userId, reason);
      }
    }
    for (const userId of ignoring) recipients.delete(userId);
    if (event.actorId) recipients.delete(event.actorId);
    return recipients;
  }

  /** `@org/team` counts only for the repository's own organization, and only from one of its members, so nobody can page a whole team from outside. */
  private async mentionsIn(
    text: string | null,
    thread: Thread,
    actorId: string | null,
  ) {
    const references = text ? parseReferences(text) : [];
    const usernames = references
      .flatMap((reference) =>
        reference.kind === 'mention' ? [reference.username] : [],
      )
      .slice(0, MAX_MENTIONS);
    const teamNames = references
      .flatMap((reference) => (reference.kind === 'team' ? [reference] : []))
      .slice(0, MAX_MENTIONS);

    const users = usernames.length
      ? await this.db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(inArray(schema.user.username, usernames))
      : [];

    let teams: string[] = [];
    if (teamNames.length > 0 && thread.organizationId && actorId) {
      const [organization] = await this.db
        .select({ slug: schema.organization.slug })
        .from(schema.organization)
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.organizationId, schema.organization.id),
            eq(schema.member.userId, actorId),
          ),
        )
        .where(eq(schema.organization.id, thread.organizationId));
      const wanted = new Set(
        teamNames
          .filter((team) => team.organization === organization?.slug)
          .map((team) => team.team),
      );
      if (wanted.size > 0) {
        const members = await this.db
          .select({ userId: schema.teamMember.userId, team: schema.team.name })
          .from(schema.team)
          .innerJoin(
            schema.teamMember,
            eq(schema.teamMember.teamId, schema.team.id),
          )
          .where(eq(schema.team.organizationId, thread.organizationId));
        teams = members
          .filter((member) => wanted.has(teamSlug(member.team)))
          .map((member) => member.userId);
      }
    }

    return { users: users.map((user) => user.id), teams };
  }

  /** Only to verified addresses, so nobody can sign up with someone else's address and have Ghost mail them. Best effort: a failed send is logged and skipped. */
  private async email(
    event: StoredEvent,
    thread: Thread,
    activity: Activity,
    recipients: Map<string, NotificationReason>,
  ) {
    const [people, actor] = await Promise.all([
      this.db
        .select({ id: schema.user.id, email: schema.user.email })
        .from(schema.user)
        .where(
          and(
            inArray(schema.user.id, [...recipients.keys()]),
            eq(schema.user.emailVerified, true),
          ),
        ),
      event.actorId
        ? this.db
            .select({ username: schema.user.username })
            .from(schema.user)
            .where(eq(schema.user.id, event.actorId))
            .then(([row]) => row?.username)
        : undefined,
    ]);

    const kind = thread.isPullRequest ? 'pulls' : 'issues';
    for (const person of people) {
      try {
        await this.mail.sendThreadEmail(person.email, {
          template: activity.template,
          threadId: thread.id,
          idempotencyKey: `${event.id}:${person.id}`,
          // a title is user input, and a line break in a header would start a new one
          subject: `[${thread.repository}] ${thread.title.replace(/[\r\n]+/g, ' ')} (#${thread.number})`,
          context: {
            ...activity.context,
            repository: thread.repository,
            number: thread.number,
            title: thread.title,
            isPullRequest: thread.isPullRequest,
            path: `/${thread.repository}/${kind}/${thread.number}`,
            reason: recipients.get(person.id),
            actor: actor ?? 'Someone',
          },
        });
      } catch (error) {
        this.logger.warn(
          `Emailing ${person.id} about ${event.type} on ${thread.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function excerpt(text: string) {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_LENGTH
    ? `${trimmed.slice(0, EXCERPT_LENGTH)}…`
    : trimmed;
}
