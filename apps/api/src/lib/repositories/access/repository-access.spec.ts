import { describe, expect, it } from 'vitest';

import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from './repository-access.errors.js';
import { roleHierarchy } from '@ghost/permissions';
import {
  type Actor,
  decideAccess,
  type Grants,
  type RepositoryOperation,
  roleOf,
} from './repository-access.js';

const owner = { userId: 'user_owner' } satisfies Actor;
const stranger = { userId: 'user_stranger' } satisfies Actor;

const repo = (visibility: 'public' | 'private') =>
  ({ ownerId: owner.userId, visibility }) as Parameters<typeof decideAccess>[0];

const operations: RepositoryOperation[] = [
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
];

const grants = (
  collaboratorRole: Grants['collaboratorRole'],
  memberRole: string | null = null,
  teamRole: Grants['teamRole'] = null,
  basePermission: Grants['basePermission'] = 'read',
): Grants => ({ collaboratorRole, memberRole, teamRole, basePermission });

const orgRepo = { ownerId: owner.userId, organizationId: 'org_ghost' };

describe('roleOf', () => {
  it('makes the owner the owner, whatever collaboration says', () => {
    expect(roleOf(repo('public')!, grants('read'), owner)).toBe('owner');
  });

  it('gives a collaborator their role and everyone else none', () => {
    expect(roleOf(repo('public')!, grants('triage'), stranger)).toBe('triage');
    expect(roleOf(repo('public')!, grants(null), stranger)).toBeNull();
    expect(roleOf(repo('public')!, grants('admin'), null)).toBeNull();
  });

  it("ignores membership on a user's own repository", () => {
    expect(roleOf(repo('public')!, grants(null, 'owner'), stranger)).toBeNull();
  });

  it('gives an organization repository no owner but its creator nothing', () => {
    expect(roleOf(orgRepo, grants(null), owner)).toBeNull();
  });

  it("makes the organization's owners owners and its admins admins of every repository", () => {
    expect(roleOf(orgRepo, grants(null, 'owner', null, null), stranger)).toBe(
      'owner',
    );
    expect(roleOf(orgRepo, grants(null, 'admin', null, null), stranger)).toBe(
      'admin',
    );
  });

  it('gives a member the base permission, or nothing without one', () => {
    expect(
      roleOf(orgRepo, grants(null, 'member', null, 'write'), stranger),
    ).toBe('write');
    expect(
      roleOf(orgRepo, grants(null, 'member', null, null), stranger),
    ).toBeNull();
  });

  it('raises a member above the base permission through teams and collaboration', () => {
    expect(
      roleOf(orgRepo, grants(null, 'member', 'maintain', 'read'), stranger),
    ).toBe('maintain');
    expect(
      roleOf(orgRepo, grants('admin', 'member', null, null), stranger),
    ).toBe('admin');
  });

  it('grants a team role to someone who is not a member', () => {
    expect(roleOf(orgRepo, grants(null, null, 'triage'), stranger)).toBe(
      'triage',
    );
  });

  it('grants nothing for a role outside the organization roles', () => {
    expect(
      roleOf(orgRepo, grants(null, 'billing', null, 'read'), stranger),
    ).toBeNull();
  });
});

describe('decideAccess', () => {
  it('lets anyone read a public repository', () => {
    for (const actor of [null, stranger, owner])
      expect(decideAccess(repo('public'), null, actor, 'read')).toBeTruthy();
  });

  it('lets a role do exactly the operations at or below it', () => {
    for (const role of roleHierarchy) {
      for (const operation of operations) {
        const allowed =
          roleHierarchy.indexOf(role) >= roleHierarchy.indexOf(operation);
        const decide = () =>
          decideAccess(repo('private'), role, stranger, operation);
        if (allowed) expect(decide().viewerRole).toBe(role);
        else expect(decide).toThrow(RepositoryForbiddenError);
      }
    }
  });

  it('hides a private repository from anyone without a role', () => {
    expect(() => decideAccess(repo('private'), null, stranger, 'read')).toThrow(
      RepositoryNotFoundError,
    );
  });

  it('forbids rather than hides a readable repository', () => {
    expect(() => decideAccess(repo('public'), null, stranger, 'write')).toThrow(
      RepositoryForbiddenError,
    );
  });

  it('challenges an anonymous actor instead of revealing anything', () => {
    for (const [repository, operation] of [
      [repo('private'), 'read'],
      [repo('public'), 'write'],
      [null, 'read'],
    ] as const)
      expect(() => decideAccess(repository, null, null, operation)).toThrow(
        AuthenticationRequiredError,
      );
  });

  it('reports a missing repository to an authenticated actor', () => {
    expect(() => decideAccess(null, null, stranger, 'read')).toThrow(
      RepositoryNotFoundError,
    );
  });
});
