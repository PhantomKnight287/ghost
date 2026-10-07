import { schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import type { Executor } from './close-issue.js';

/** Marks an issue or pull request as changed, for lists sorted by recent activity. */
export function touchIssue(db: Executor, issueId: string) {
  return db
    .update(schema.issue)
    .set({ updatedAt: new Date() })
    .where(eq(schema.issue.id, issueId));
}
