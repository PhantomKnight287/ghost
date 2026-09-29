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
};

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
