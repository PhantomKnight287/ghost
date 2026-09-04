import { createAccessControl } from 'better-auth/plugins/access';

export const statement = {
  organization: ['read', 'update', 'delete', 'transfer', 'billing'],
  member: ['read', 'create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['read', 'create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  repository: [
    'read',
    'create',
    'push',
    'merge',
    'manage',
    'rename',
    'archive',
    'delete',
    'transfer',
    'manageAccess',
    'manageSecurity',
  ],
  issue: ['read', 'create', 'comment', 'triage', 'close', 'delete'],
} as const;

export const ac = createAccessControl(statement);

/**
 * Each rung inherits the one below it, the way GitHub's roles do.
 */

/** Read: clone, open issues and pull requests, comment. */
const readStatements = {
  organization: ['read'],
  member: ['read'],
  invitation: [],
  team: ['read'],
  ac: ['read'],
  repository: ['read'],
  issue: ['read', 'create', 'comment'],
} as const;

/** Triage: read, plus managing other people's issues without write access. */
const triageStatements = {
  ...readStatements,
  issue: [...readStatements.issue, 'triage', 'close'],
} as const;

/** Write: triage, plus pushing and merging. */
const writeStatements = {
  ...triageStatements,
  repository: [...triageStatements.repository, 'push', 'merge'],
} as const;

/** Maintain: write, plus repository upkeep short of destructive settings. */
const maintainStatements = {
  ...writeStatements,
  team: [...writeStatements.team, 'create', 'update'],
  repository: [...writeStatements.repository, 'manage', 'rename'],
} as const;

/** Admin: maintain, plus access control and destructive repository actions. */
const adminStatements = {
  ...maintainStatements,
  organization: [...maintainStatements.organization, 'update'],
  member: [...maintainStatements.member, 'create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: [...maintainStatements.team, 'delete'],
  ac: [...maintainStatements.ac, 'create', 'update', 'delete'],
  repository: [
    ...maintainStatements.repository,
    'create',
    'archive',
    'delete',
    'manageAccess',
    'manageSecurity',
  ],
  issue: [...maintainStatements.issue, 'delete'],
} as const;

/** Owner: admin, plus the actions that end the organization or move it. */
const ownerStatements = {
  ...adminStatements,
  organization: [...adminStatements.organization, 'delete', 'transfer', 'billing'],
  repository: [...adminStatements.repository, 'transfer'],
} as const;

export const read = ac.newRole(readStatements);
export const triage = ac.newRole(triageStatements);
export const write = ac.newRole(writeStatements);
export const maintain = ac.newRole(maintainStatements);
export const admin = ac.newRole(adminStatements);
export const owner = ac.newRole(ownerStatements);

export const roles = { read, triage, write, maintain, admin, owner };

export type Role = keyof typeof roles;

/** Lowest to highest, for comparisons and for rendering pickers in order. */
export const roleHierarchy = [
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
  'owner',
] as const satisfies readonly Role[];
