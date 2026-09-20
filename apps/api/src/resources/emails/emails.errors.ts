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

export class EmailAlreadyVerifiedError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(email: string) {
    super(`${email} is already verified`);
  }
}

export class ResendTooSoonError extends DomainError {
  status: number = HttpStatus.TOO_MANY_REQUESTS;

  constructor() {
    super('A link was just sent. Check your inbox, then try again in a minute');
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
