import { describe, expect, it } from 'vitest';

import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from '../../../lib/git/repository-access/repository-access.errors.js';
import { roleHierarchy } from '../../../lib/permissions.js';
import {
  type Actor,
  decideAccess,
  type RepositoryOperation,
  roleOf,
} from './repository-access.service.js';

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

describe('roleOf', () => {
  it('makes the owner the owner, whatever collaboration says', () => {
    expect(roleOf(repo('public')!, 'read', owner)).toBe('owner');
  });

  it('gives a collaborator their role and everyone else none', () => {
    expect(roleOf(repo('public')!, 'triage', stranger)).toBe('triage');
    expect(roleOf(repo('public')!, null, stranger)).toBeNull();
    expect(roleOf(repo('public')!, 'admin', null)).toBeNull();
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
