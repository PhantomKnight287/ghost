import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';
import { MAX_STATUSES_PER_CONTEXT } from './commit-statuses.js';

export class TooManyStatusesError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(sha: string, context: string) {
    super(
      `${sha} already has ${MAX_STATUSES_PER_CONTEXT} statuses for the context: ${context}`,
    );
  }
}

export class InvalidStatusShaError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(sha: string) {
    super(`Not a commit in this repository: ${sha}`);
  }
}
