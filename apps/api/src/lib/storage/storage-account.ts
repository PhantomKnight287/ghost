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

export function storageKindOf(repository: {
  parentRepositoryId: string | null;
}): RepositoryStorageKind {
  return repository.parentRepositoryId ? 'fork' : 'repository';
}

/** LFS objects count against the fork limit in a fork, like everything else a fork holds, and against the LFS limit anywhere else. */
export function lfsKindOf(repository: {
  parentRepositoryId: string | null;
}): Extract<StorageKind, 'fork' | 'lfs'> {
  return repository.parentRepositoryId ? 'fork' : 'lfs';
}

/** Release assets count against the fork limit in a fork, like everything else a fork holds, and against the asset limit anywhere else. */
export function assetKindOf(repository: {
  parentRepositoryId: string | null;
}): Extract<StorageKind, 'fork' | 'asset'> {
  return repository.parentRepositoryId ? 'fork' : 'asset';
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
