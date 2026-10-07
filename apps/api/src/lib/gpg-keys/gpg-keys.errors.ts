import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class InvalidGpgKeyError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(detail: string) {
    super(`That is not a usable public key: ${detail}`);
  }
}

export class GpgKeyAlreadyExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('That key is already on an account');
  }
}

export class GpgKeyNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Key not found on this account');
  }
}

export class GpgKeyEmailNotVerifiedError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(emails: string[]) {
    super(
      emails.length === 0
        ? 'The key carries no email address, so it cannot be matched to your commits'
        : `Verify one of the key's addresses on this account first: ${emails.join(', ')}`,
    );
  }
}
