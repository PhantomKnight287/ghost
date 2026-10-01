import { type Database, schema } from '@ghost/db';
import { and, eq, inArray } from 'drizzle-orm';

import { RepositoryImportingError } from './imports.errors.js';

/** An import writes issue numbers GitHub chose, so nothing else may take one until it is done. */
export async function assertNotImporting(
  db: Pick<Database, 'select'>,
  repositoryId: string,
) {
  const [active] = await db
    .select({ id: schema.repositoryImport.id })
    .from(schema.repositoryImport)
    .where(
      and(
        eq(schema.repositoryImport.repositoryId, repositoryId),
        inArray(schema.repositoryImport.status, ['pending', 'running']),
      ),
    );
  if (active) throw new RepositoryImportingError();
}
