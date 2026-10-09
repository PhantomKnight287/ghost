import type { Database } from '@ghost/db';

export function createLoaders(_db: Database) {
  return {};
}

export type Loaders = ReturnType<typeof createLoaders>;
