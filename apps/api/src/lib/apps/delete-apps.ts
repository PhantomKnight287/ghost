import { schema } from '@ghost/db';
import { and, inArray, isNull, type SQL } from 'drizzle-orm';

import type { Executor } from '../db/executor.js';

/** Soft-deletes the live apps `where` matches: the row keeps its App ID and slug so neither is reused, and its bot user stays for attribution. Keys, installations (with their tokens) and the webhook go, so nothing can act as the app again. */
export async function deleteApps(db: Executor, where: SQL) {
  const deleted = await db
    .update(schema.app)
    .set({ deletedAt: new Date() })
    .where(and(where, isNull(schema.app.deletedAt)))
    .returning({ id: schema.app.id });
  if (deleted.length === 0) return;
  const ids = deleted.map(({ id }) => id);
  await db
    .delete(schema.webhookEndpoint)
    .where(inArray(schema.webhookEndpoint.appId, ids));
  await db
    .delete(schema.appPublicKey)
    .where(inArray(schema.appPublicKey.appId, ids));
  await db
    .delete(schema.appInstallation)
    .where(inArray(schema.appInstallation.appId, ids));
}
