import { DomainError } from '../../domain/errors.js';

export class UserNotFoundError extends DomainError {
  readonly status = 404;
  constructor(userId: string) {
    super(`User ${userId} not found`);
  }
}
