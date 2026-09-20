import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class EmailAlreadyTakenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(email: string) {
    super(`${email} already belongs to an account`);
  }
}

export class EmailNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Email address not found on this account');
  }
}

export class EmailNotVerifiedError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(email: string) {
    super(`${email} is not verified yet`);
  }
}

export class InvalidVerificationTokenError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('Verification link is invalid or has expired');
  }
}

export class MailNotConfiguredError extends DomainError {
  status: number = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super(
      'This instance has no mail configured, so addresses cannot be verified',
    );
  }
}
