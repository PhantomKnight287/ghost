import { schema } from '@ghost/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

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

/** Which of an account's limits bytes count against. Forks have their own, since people fork large repositories they never push to. */
export type StorageKind = 'repository' | 'fork' | 'lfs' | 'asset';

export type RepositoryStorageKind = Extract<StorageKind, 'repository' | 'fork'>;

/** What a repository's files are billed as: everything a fork holds counts against the fork limit, and anything else against `kind`. */
export function billedKindOf<Kind extends StorageKind>(
  repository: { parentRepositoryId: string | null },
  kind: Kind,
): Kind | 'fork' {
  return repository.parentRepositoryId ? 'fork' : kind;
}

/** Repositories of `kind` whose files count against `account`. */
export function billedTo(account: StorageAccount, kind: RepositoryStorageKind) {
  const ofKind =
    kind === 'fork'
      ? isNotNull(schema.repository.parentRepositoryId)
      : isNull(schema.repository.parentRepositoryId);
  return 'organizationId' in account
    ? and(eq(schema.repository.organizationId, account.organizationId), ofKind)
    : and(
        eq(schema.repository.ownerId, account.userId),
        isNull(schema.repository.organizationId),
        ofKind,
      );
}

export function storageAccountKey(account: StorageAccount) {
  return 'organizationId' in account
    ? `organization:${account.organizationId}`
    : `user:${account.userId}`;
}
