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

export type ValidationFailure = {
  resource: string;
  field: string;
  code: 'missing_field' | 'invalid' | 'already_exists';
};

/** GitHub REST's 422 "Validation Failed" with the fields that failed, as `errors` in the body. */
export class GithubValidationError extends DomainError {
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(readonly errors: ValidationFailure[]) {
    super('Validation Failed');
  }
}

/** GitHub's REST 404, worded "Not Found" whatever was missing, so a private resource and a missing one read the same. */
export class GithubNotFoundError extends DomainError {
  readonly status = HttpStatus.NOT_FOUND;

  constructor() {
    super('Not Found');
  }
}

export class GithubConflictError extends DomainError {
  readonly status = HttpStatus.CONFLICT;
}

/** GitHub answers every merge it will not make with 405. */
export class NotMergeableError extends DomainError {
  readonly status = HttpStatus.METHOD_NOT_ALLOWED;

  constructor() {
    super('Pull Request is not mergeable');
  }
}
