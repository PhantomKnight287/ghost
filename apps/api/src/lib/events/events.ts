import { schema } from '@ghost/db';
import { sql } from 'drizzle-orm';

import type { Commit } from '../git/commits/list-commits.js';
import type { Executor } from '../db/executor.js';

/** What each event carries. Ids only: a consumer reads the rows as they are when it runs, and skips an event whose rows are gone. A deletion carries what it deleted, since there is no row left to read. Issue events cover pull requests too, since a pull request is an issue. */
export type EventPayloads = {
  'issue.opened': { issueId: string };
  'issue.edited': { issueId: string };
  'issue.closed': { issueId: string };
  'issue.reopened': { issueId: string };
  'issue.assigned': { issueId: string; assigneeId: string };
  'issue.unassigned': { issueId: string; assigneeId: string };
  'issue.labeled': { issueId: string; labelId: string };
  'issue.unlabeled': { issueId: string; labelId: string };
  'issue.commented': { issueId: string; commentId: string };
  'issue.comment_edited': { issueId: string; commentId: string };
  'issue.comment_deleted': {
    issueId: string;
    comment: { id: string; body: string };
  };
  'pull_request.ready_for_review': { issueId: string };
  'pull_request.converted_to_draft': { issueId: string };
  'pull_request.merged': { issueId: string };
  /** A push moved an open request's head. Carries its commits, like `push`, since they are not rows to read back. */
  'pull_request.synchronized': {
    issueId: string;
    /** 40 zeros when the head branch was recreated. */
    before: string;
    after: string;
    /** The push rewrote the branch rather than adding to it. */
    forced: boolean;
    /** What the push added to the request, newest first, at most `MAX_PUSH_COMMITS`. */
    commits: Commit[];
  };
  'pull_request.reviewed': { issueId: string; reviewId: string };
  'pull_request.review_dismissed': { issueId: string; reviewId: string };
  'pull_request.review_commented': { issueId: string; commentId: string };
  'label.created': { labelId: string };
  'label.edited': { labelId: string };
  'label.deleted': {
    label: {
      id: string;
      name: string;
      description: string | null;
      color: string;
    };
  };
  'release.created': { releaseId: string };
  /** On create when not a draft, and each time a draft is published. */
  'release.published': { releaseId: string };
  'release.edited': { releaseId: string };
  'release.deleted': {
    release: { id: string; tagName: string; name: string | null };
  };
  'star.created': Record<string, never>;
  'star.deleted': Record<string, never>;
  /** Watching at `all`; the actor is the watcher. */
  'watch.started': Record<string, never>;
  /** Published on the repository that was forked. */
  'fork.created': { forkId: string };
  'repository.edited': Record<string, never>;
  /** `from` is the previous owner's name. */
  'repository.transferred': { from: string };
  /** An invited collaborator accepted. */
  'member.added': { userId: string };
  /** A collaborator who had accepted was removed, or left. */
  'member.removed': { userId: string };
  /** One per ref a push moved. Unlike the others it carries what it describes, since commits are not rows to read back. */
  push: {
    ref: string;
    /** 40 zeros when the push created the ref. */
    before: string;
    /** 40 zeros when the push deleted the ref. */
    after: string;
    /** Newest first, at most `MAX_PUSH_COMMITS`. */
    commits: Commit[];
  };
};

/** Enough to see what a push did without making a huge push a huge payload; GitHub caps at 20 too. */
export const MAX_PUSH_COMMITS = 20;

export type EventType = keyof EventPayloads;

export type RepositoryEvent = {
  [Type in EventType]: {
    type: Type;
    repositoryId: string;
    actorId: string | null;
    payload: EventPayloads[Type];
  };
}[EventType];

/** An event as a consumer receives it: stored, so it has an id that stays the same across retries. */
export type StoredEvent = RepositoryEvent & { id: string; createdAt: Date };

/** Queues `event` for every consumer. Pass the transaction making the change, so the event exists exactly when the change does. */
export async function publishEvent(db: Executor, event: RepositoryEvent) {
  await db.insert(schema.outboxEvent).values(event);
  // Postgres holds the notification until the transaction commits and folds repeats into one.
  await db.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, '')`);
}

export const OUTBOX_CHANNEL = 'outbox';
