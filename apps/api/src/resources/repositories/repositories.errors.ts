import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class RepositoryNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super(`Repository not found`);
  }
}

export class InvalidCursorError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super(`Invalid pagination cursor`);
  }
}

export class InvalidRepositoryPathError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(reason: string) {
    super(`Invalid repository path: ${reason}`);
  }
}

export class BranchNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(branch: string) {
    super(`Branch not found: ${branch}`);
  }
}

export class BlobNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(path: string) {
    super(`File not found: ${path}`);
  }
}

export class CommitNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(sha: string) {
    super(`Commit not found: ${sha}`);
  }
}
