import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

/** GitHub's NOT_FOUND, worded as GitHub words it, e.g. "Could not resolve to a Repository with the name 'o/r'." */
export class CouldNotResolveError extends DomainError {
  readonly status = HttpStatus.NOT_FOUND;
}

export class BadCredentialsError extends DomainError {
  readonly status = HttpStatus.UNAUTHORIZED;

  constructor() {
    super('Bad credentials');
  }
}

export class RequiresAuthenticationError extends DomainError {
  readonly status = HttpStatus.UNAUTHORIZED;

  constructor() {
    super('Requires authentication');
  }
}

export class GithubForbiddenError extends DomainError {
  readonly status = HttpStatus.FORBIDDEN;
}

export class UnprocessableError extends DomainError {
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}
