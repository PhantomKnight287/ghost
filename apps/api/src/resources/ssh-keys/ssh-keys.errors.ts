import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class InvalidSshKeyError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(detail: string) {
    super(`That is not a usable public key: ${detail}`);
  }
}

export class SshKeyAlreadyExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('That key is already on an account');
  }
}

export class SshKeyNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Key not found on this account');
  }
}
