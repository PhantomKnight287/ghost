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

export class InsufficientScopesError extends DomainError {
  readonly status = HttpStatus.FORBIDDEN;

  constructor(
    field: string,
    readonly accepted: readonly string[],
    granted: readonly string[],
  ) {
    super(
      `Your token has not been granted the required scopes to execute this query. The '${field}' field requires one of the following scopes: [${accepted.map((scope) => `'${scope}'`).join(', ')}], but your token has only been granted the: [${granted.map((scope) => `'${scope}'`).join(', ')}] scopes.`,
    );
  }
}
