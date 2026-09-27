import { schema } from '@ghost/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Who pays for a repository's stored files: its organization, or its owner when it belongs to no organization. */
export type StorageAccount = { organizationId: string } | { userId: string };

export function storageAccountOf(repository: {
  ownerId: string;
  organizationId: string | null;
}): StorageAccount {
  return repository.organizationId
    ? { organizationId: repository.organizationId }
    : { userId: repository.ownerId };
}

/** Repositories whose files count against `account`. */
export function billedTo(account: StorageAccount) {
  return 'organizationId' in account
    ? eq(schema.repository.organizationId, account.organizationId)
    : and(
        eq(schema.repository.ownerId, account.userId),
        isNull(schema.repository.organizationId),
      );
}

export function storageAccountKey(account: StorageAccount) {
  return 'organizationId' in account
    ? `organization:${account.organizationId}`
    : `user:${account.userId}`;
}
