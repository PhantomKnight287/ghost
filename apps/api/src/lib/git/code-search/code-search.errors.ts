import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../domain/errors.js';

export class CodeSearchUnavailableError extends DomainError {
  status: number = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(options?: ErrorOptions) {
    super('Code search is not available right now', options);
  }
}

export class InvalidSearchQueryError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(reason: string) {
    super(`Invalid search query: ${reason}`);
  }
}
