import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { RepositoryImportingError } from './imports.errors.js';

/** An import writes GitHub's issue numbers, so nothing else may take one until it is done. Call inside the issue-inserting transaction: the shared lock on the import row serializes it against a retry's `FOR UPDATE`, so each sees the other's write. */
export async function assertNotImporting(
  tx: Pick<Database, 'select'>,
  repositoryId: string,
) {
  // Filtering by status in SQL would skip locking a failed row, which is the one a retry is about to flip.
  const [row] = await tx
    .select({ status: schema.repositoryImport.status })
    .from(schema.repositoryImport)
    .where(eq(schema.repositoryImport.repositoryId, repositoryId))
    .for('share');
  if (row?.status === 'pending' || row?.status === 'running') {
    throw new RepositoryImportingError();
  }
}

export const MAX_IMPORT_ATTEMPTS = 6;
