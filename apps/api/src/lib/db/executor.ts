import type { Database } from '@ghost/db';

/** A database or a transaction: what a write that may run inside either one takes. */
export type Executor = Pick<
  Database,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;
