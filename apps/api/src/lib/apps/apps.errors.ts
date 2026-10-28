import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class AppNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('App not found');
  }
}

export class AppNameTakenError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app already uses that name');
  }
}

export class InvalidAppPermissionsError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(message: string) {
    super(message);
  }
}

export class TooManyPrivateKeysError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app can hold at most 20 private keys');
  }
}

export class PrivateKeyNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Private key not found');
  }
}

export class AppNameUnusableError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app name needs at least one letter or digit');
  }
}
