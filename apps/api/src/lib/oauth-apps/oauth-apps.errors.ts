import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class OauthAppNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('OAuth app not found on this account');
  }
}

export class BuiltInOauthAppError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('Built-in OAuth apps cannot be changed');
  }
}
