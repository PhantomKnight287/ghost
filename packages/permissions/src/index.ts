import { createAccessControl } from 'better-auth/plugins/access';

/** Repository roles, lowest to highest. Each includes everything below it, the way GitHub's do; `owner` is held only by a repository's owner. */
export const roleHierarchy = [
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
  'owner',
] as const;

export type Role = (typeof roleHierarchy)[number];

/** Whether `role` includes everything `needed` may do. */
export function atLeast(role: Role | null | undefined, needed: Role) {
  return (
    role != null && roleHierarchy.indexOf(role) >= roleHierarchy.indexOf(needed)
  );
}

/** What Better Auth's organization plugin checks: managing the organization itself, never a repository. */
export const statement = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

/** Organization roles, lowest to highest. Admins administer and owners own every repository of the organization; members get its base permission (docs/0023). */
export const organizationRoleHierarchy = ['member', 'admin', 'owner'] as const;

export type OrganizationRole = (typeof organizationRoleHierarchy)[number];

/** Admins and owners run the organization: its settings, people, teams and every repository. */
export function administers(role: OrganizationRole | null | undefined) {
  return role === 'admin' || role === 'owner';
}

/** The highest organization role in a Better Auth `member.role`, which may hold several joined by commas. Custom roles count for nothing. */
export function organizationRoleOf(
  memberRole: string | null | undefined,
): OrganizationRole | null {
  const held = (memberRole?.split(',') ?? [])
    .map((role) =>
      organizationRoleHierarchy.indexOf(role.trim() as OrganizationRole),
    )
    .filter((index) => index >= 0);
  return held.length ? organizationRoleHierarchy[Math.max(...held)] : null;
}

const member = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
});

const admin = ac.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['read'],
});

const owner = ac.newRole({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
});

/** The roles Better Auth's organization plugin knows. */
export const roles = { member, admin, owner };
