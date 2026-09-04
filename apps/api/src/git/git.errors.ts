import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../domain/errors.js';

export class UnsupportedGitServiceError extends DomainError {
  status: number = HttpStatus.NOT_ACCEPTABLE;

  constructor() {
    super(
      'dumb git protocol not supported. Please update your git to use smart protocol. <https://git-scm.com/book/be/v2/Git-Internals-Transfer-Protocols>',
    );
  }
}
