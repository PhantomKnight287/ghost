import { schema } from '@ghost/db';

import type { Executor } from '../issues/close-issue.js';

/** What each event carries. Ids only: a consumer reads the rows as they are when it runs, and skips an event whose rows are gone. Issue events cover pull requests too, since a pull request is an issue. */
export type EventPayloads = {
  'issue.opened': { issueId: string };
  'issue.closed': { issueId: string };
  'issue.reopened': { issueId: string };
  'issue.assigned': { issueId: string; assigneeId: string };
  'issue.commented': { issueId: string; commentId: string };
  'pull_request.merged': { issueId: string };
  'pull_request.reviewed': { issueId: string; reviewId: string };
  'pull_request.review_commented': { issueId: string; commentId: string };
  /** One per ref a push moved. Unlike the others it carries what it describes, since commits are not rows to read back. */
  push: {
    ref: string;
    /** 40 zeros when the push created the ref. */
    before: string;
    /** 40 zeros when the push deleted the ref. */
    after: string;
    /** Newest first, at most `MAX_PUSH_COMMITS`. */
    commits: PushCommit[];
  };
};

export type PushCommit = {
  sha: string;
  message: string;
  author: { name: string; email: string };
  timestamp: string;
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
}
