import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class ReleaseNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Release not found');
  }
}

export class ReleaseAlreadyExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(tagName: string) {
    super(`A release already exists for the tag: ${tagName}`);
  }
}

export class InvalidTagNameError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(tagName: string) {
    super(`Not a valid tag name: ${tagName}`);
  }
}

export class TagTargetNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(target: string) {
    super(`Nothing to tag at: ${target}`);
  }
}
