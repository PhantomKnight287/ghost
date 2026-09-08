import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class PullRequestNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Pull request not found');
  }
}

export class PullRequestAlreadyOpenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(number: number) {
    super(`These branches already have an open pull request: #${number}`);
  }
}

export class SameBranchPullRequestError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('A pull request cannot merge a branch into itself');
  }
}

export class UnrelatedHistoriesError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('These branches share no common history');
  }
}

export class PullRequestNotOpenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(state: string) {
    super(`This pull request is ${state}`);
  }
}

export class PullRequestConflictError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('This pull request has conflicts that must be resolved locally');
  }
}

export class NothingToMergeError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('The base branch already contains every commit from the head branch');
  }
}

export class UnrelatedRepositoriesError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super(
      'A pull request must come from the repository itself or a fork of it',
    );
  }
}
