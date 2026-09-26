import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class RepositoryNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super(`Repository not found`);
  }
}

export class RepositoryAlreadyForkedError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(slug: string) {
    super(`You already have a fork of this repository: ${slug}`);
  }
}

export class CannotForkOwnRepositoryError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('You already own this repository');
  }
}

export class TransferTargetError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super(
      'A repository can move to your own account or to an organization you administer, and not where it already is',
    );
  }
}

export class TransferNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('No pending transfer of this repository to you');
  }
}

export class RepositoryNameTakenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(owner: string, slug: string) {
    super(`${owner} already has a repository named ${slug}`);
  }
}

export class RepositoryHeadsOpenPullRequestError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(pullRequest: string) {
    super(
      `This repository has open pull requests into other repositories. Merge or close them first, starting with ${pullRequest}`,
    );
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
