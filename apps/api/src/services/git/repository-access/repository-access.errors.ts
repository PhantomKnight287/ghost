import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../../domain/errors.js';

/** Anonymous actor, non-public repository. Git over HTTP renders this as a Basic challenge. */
export class AuthenticationRequiredError extends DomainError {
  readonly status = HttpStatus.UNAUTHORIZED;

  constructor() {
    super('Authentication required');
  }
}

/** The actor is known and still may not do this. */
export class RepositoryForbiddenError extends DomainError {
  readonly status = HttpStatus.FORBIDDEN;

  constructor() {
    super('Insufficient permissions for this repository');
  }
}
