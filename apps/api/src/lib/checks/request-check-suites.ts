import { type Database, schema } from '@ghost/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { publishEvent } from '../events/events.js';
import { type RefTransition, ZERO_OID } from '../git/wal/wal.types.js';
import { installationCovers } from '../repositories/access/repository-access.js';
import type { RefWriter } from '../rulesets/rulesets.types.js';

const BRANCH_PREFIX = 'refs/heads/';

/** After a branch moved, every app whose live installation covers the repository with `checks: write` gets a suite for the new tip and `check_suite.requested`, as GitHub auto-triggers checks. Tags, deletions and system writes (repairs, pull refs, a new repository's first commit) request nothing. A sha that already has the app's suite is not requested again. */
export async function requestCheckSuites(
  db: Database,
  {
    repositoryId,
    transitions,
    actor,
  }: { repositoryId: string; transitions: RefTransition[]; actor: RefWriter },
) {
  if (actor === 'system') return;
  const moved = transitions.filter(
    ({ ref, newOid }) =>
      ref.startsWith(BRANCH_PREFIX) && !newOid.equals(ZERO_OID),
  );
  if (moved.length === 0) return;

  const installations = await db
    .select({
      id: schema.appInstallation.id,
      appId: schema.appInstallation.appId,
    })
    .from(schema.repository)
    .innerJoin(schema.appInstallation, installationCovers(schema.repository))
    .innerJoin(schema.app, eq(schema.app.id, schema.appInstallation.appId))
    .where(
      and(
        eq(schema.repository.id, repositoryId),
        isNull(schema.app.deletedAt),
        isNull(schema.appInstallation.suspendedAt),
        sql`${schema.appInstallation.permissions}->>'checks' = 'write'`,
      ),
    );
  if (installations.length === 0) return;

  await db.transaction(async (tx) => {
    for (const { ref, oldOid, newOid } of moved) {
      const created = await tx
        .insert(schema.checkSuite)
        .values(
          installations.map((installation) => ({
            repositoryId,
            headSha: newOid.toString('hex'),
            headBranch: ref.slice(BRANCH_PREFIX.length),
            appId: installation.appId,
            installationId: installation.id,
            before: oldOid.toString('hex'),
            after: newOid.toString('hex'),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.checkSuite.id });
      for (const { id } of created)
        await publishEvent(tx, {
          type: 'check_suite.requested',
          repositoryId,
          actorId: actor.userId,
          payload: { checkSuiteId: id },
        });
    }
  });
}
