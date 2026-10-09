import {
  ownerNameOf,
  type RepositoryOperation,
} from '../repositories/access/repository-access.js';
import { AuthenticationRequiredError } from '../repositories/access/repository-access.errors.js';
import { RepositoryNotFoundError } from '../repositories/repositories.errors.js';
import type { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { DomainError } from '../../domain/errors.js';
import { CouldNotResolveError } from './github.errors.js';

/** The access check, with "can't see it" in GitHub's words: anonymous and stranger reads of a private repository both read as missing. */
export async function authorizeOrNotFound(
  access: RepositoryAccessService,
  {
    owner,
    name,
    requesterId,
    operation,
  }: {
    owner: string;
    name: string;
    requesterId?: string;
    operation?: RepositoryOperation;
  },
) {
  try {
    return await access.authorize({
      username: owner,
      repo: name,
      requesterId,
      operation,
    });
  } catch (error) {
    if (
      error instanceof RepositoryNotFoundError ||
      error instanceof AuthenticationRequiredError
    ) {
      throw new CouldNotResolveError(
        `Could not resolve to a Repository with the name '${owner}/${name}'.`,
      );
    }
    throw error;
  }
}

/** Whether an error means the viewer cannot see the thing (401) or it is not there (404), both of which GitHub answers as "could not resolve". */
export function isUnresolvable(error: unknown) {
  return (
    error instanceof DomainError &&
    (error.status === 401 || error.status === 404)
  );
}

/** The promise's value, or null when it fails as unresolvable; any other failure, such as the database being down, propagates. */
export function orNull<T>(promise: Promise<T>) {
  return promise.catch((error: unknown) => {
    if (isUnresolvable(error)) return null;
    throw error;
  });
}
