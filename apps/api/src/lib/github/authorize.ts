import { ownerNameOf, type RepositoryOperation } from '../repositories/access/repository-access.js';
import { AuthenticationRequiredError } from '../repositories/access/repository-access.errors.js';
import { RepositoryNotFoundError } from '../repositories/repositories.errors.js';
import type { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { CouldNotResolveError } from './github.errors.js';

/** The access check, with "can't see it" in GitHub's words: anonymous and stranger reads of a private repository both read as missing. */
export async function authorizeOrNotFound(
  access: RepositoryAccessService,
  { owner, name, requesterId, operation }: { owner: string; name: string; requesterId?: string; operation?: RepositoryOperation },
) {
  try {
    return await access.authorize({ username: owner, repo: name, requesterId, operation });
  } catch (error) {
    if (error instanceof RepositoryNotFoundError || error instanceof AuthenticationRequiredError) {
      throw new CouldNotResolveError(`Could not resolve to a Repository with the name '${owner}/${name}'.`);
    }
    throw error;
  }
}
