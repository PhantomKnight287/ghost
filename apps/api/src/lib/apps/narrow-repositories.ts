import { schema } from '@ghost/db';
import { and, eq, inArray, or } from 'drizzle-orm';

import type { Executor } from '../db/executor.js';
import { installationCovers } from '../repositories/access/repository-access.js';
import { InstallationRepositoriesError } from './apps.errors.js';

/** The repositories a token is narrowed to by name or id, every one covered by the installation; null when the body narrows nothing. */
export async function narrowRepositories(
  executor: Executor,
  installationId: string,
  body: { repositories?: string[]; repository_ids?: number[] },
): Promise<string[] | null> {
  const names = body.repositories ?? [];
  const ids = body.repository_ids ?? [];
  if (names.length === 0 && ids.length === 0) return null;
  const covered = await executor
    .select({ id: schema.repository.id })
    .from(schema.repository)
    .innerJoin(
      schema.appInstallation,
      eq(schema.appInstallation.id, installationId),
    )
    .where(
      and(
        installationCovers(schema.repository),
        or(
          names.length > 0 ? inArray(schema.repository.slug, names) : undefined,
          ids.length > 0
            ? inArray(schema.repository.numericId, ids)
            : undefined,
        ),
      ),
    );
  if (covered.length !== new Set([...names, ...ids]).size)
    throw new InstallationRepositoriesError();
  return covered.map(({ id }) => id);
}
