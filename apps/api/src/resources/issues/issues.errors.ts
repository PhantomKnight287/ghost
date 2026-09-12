import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class IssueNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Issue not found');
  }
}

export class IssueNotOpenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(state: string) {
    super(`This issue is ${state}`);
  }
}

export class IssueCommentNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Comment not found');
  }
}

export class LabelNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(name: string) {
    super(`Label not found: ${name}`);
  }
}

export class LabelAlreadyExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(name: string) {
    super(`A label already exists with the name: ${name}`);
  }
}
