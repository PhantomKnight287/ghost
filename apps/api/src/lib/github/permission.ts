import type { Role } from '@ghost/permissions';

import { RepositoryPermission } from '../../github/graphql/enums.js';

/** GitHub has no `owner` permission; a repository's owner holds ADMIN there. */
export function repositoryPermissionOf(role: Role | null) {
  if (!role) return null;
  if (role === 'owner' || role === 'admin') return 'ADMIN';
  return role.toUpperCase() as 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ';
}

export const WRITE_OR_ABOVE: (RepositoryPermission | null)[] = [
  RepositoryPermission.ADMIN,
  RepositoryPermission.MAINTAIN,
  RepositoryPermission.WRITE,
];
