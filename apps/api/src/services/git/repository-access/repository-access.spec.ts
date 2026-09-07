import { describe, expect, it } from 'vitest';

import { RepositoryNotFoundError } from '../../../resources/repositories/repositories.errors.js';
import {
  AuthenticationRequiredError,
  RepositoryForbiddenError,
} from './repository-access.errors.js';
import { decideAccess, type Actor } from './repository-access.service.js';

const owner = { userId: 'user_owner' } satisfies Actor;
const stranger = { userId: 'user_stranger' } satisfies Actor;

const repo = (visibility: 'public' | 'private') =>
  ({ ownerId: owner.userId, visibility }) as Parameters<typeof decideAccess>[0];

describe('decideAccess', () => {
  it('lets anyone read a public repository', () => {
    for (const actor of [null, stranger, owner])
      expect(decideAccess(repo('public'), actor, 'read')).toBeTruthy();
  });

  it('lets only the owner read a private repository', () => {
    expect(decideAccess(repo('private'), owner, 'read')).toBeTruthy();
    expect(() => decideAccess(repo('private'), stranger, 'read')).toThrow(
      RepositoryNotFoundError,
    );
  });

  it('lets only the owner write, whatever the visibility', () => {
    for (const visibility of ['public', 'private'] as const) {
      expect(decideAccess(repo(visibility), owner, 'write')).toBeTruthy();
      expect(() => decideAccess(repo(visibility), stranger, 'write')).toThrow(
        visibility === 'public'
          ? RepositoryForbiddenError
          : RepositoryNotFoundError,
      );
    }
  });

  it('challenges an anonymous actor instead of revealing anything', () => {
    for (const [repository, operation] of [
      [repo('private'), 'read'],
      [repo('public'), 'write'],
      [null, 'read'],
    ] as const)
      expect(() => decideAccess(repository, null, operation)).toThrow(
        AuthenticationRequiredError,
      );
  });

  it('reports a missing repository to an authenticated actor', () => {
    expect(() => decideAccess(null, stranger, 'read')).toThrow(
      RepositoryNotFoundError,
    );
  });
});
