import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

import { RepositoryImportingError } from './imports.errors.js';

/**
 * An import writes issue numbers GitHub chose, so nothing else may take one until it is done.
 *
 * Call it inside the transaction that inserts the issue. The shared lock on the import row makes a concurrent retry, which locks the row for update, wait for that insert to commit and see it, or makes this wait for the retry and see the import running again.
 */
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
