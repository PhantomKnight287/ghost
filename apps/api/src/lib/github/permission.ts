import type { Role } from '@ghost/permissions';

/** GitHub has no `owner` permission; a repository's owner holds ADMIN there. */
export function repositoryPermissionOf(role: Role | null) {
  if (!role) return null;
  if (role === 'owner' || role === 'admin') return 'ADMIN';
  return role.toUpperCase() as 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ';
}
