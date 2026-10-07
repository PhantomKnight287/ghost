import { atLeast, type Role } from '@ghost/permissions';

/** Whether the requester may edit an issue or pull request: its author, or anyone who can write to the repository. */
export function canEditThread(
  authorId: string,
  requesterId: string | undefined,
  viewerRole: Role | null,
) {
  if (!requesterId) return false;
  return requesterId === authorId || atLeast(viewerRole, 'write');
}
