import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class InvalidBranchNameError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(name: string) {
    super(`Not a valid branch name: ${name}`);
  }
}

export class BranchAlreadyExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(name: string) {
    super(`A branch already exists with the name: ${name}`);
  }
}

export class BranchSourceNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(source: string) {
    super(`Nothing to branch from at: ${source}`);
  }
}

export class DefaultBranchDeletionError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(name: string) {
    super(
      `The default branch cannot be deleted: ${name}. Pick another default branch in the settings first.`,
    );
  }
}

export class BranchInUseError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(name: string, number: number) {
    super(
      `The branch ${name} is used by open pull request #${number}. Close or merge it first.`,
    );
  }
}
