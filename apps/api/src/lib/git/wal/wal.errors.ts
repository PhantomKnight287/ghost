import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../domain/errors.js';

export class WalCorruptError extends DomainError {
  status: number = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(detail: string) {
    super(`Write-ahead log is corrupt: ${detail}`);
  }
}

export class NonFastForwardError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(readonly ref: string) {
    super(
      `Updates were rejected because the remote contains work you do not have locally: ${ref}`,
    );
  }
}

export class WalContentionError extends DomainError {
  status: number = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(repoId: string) {
    super(`Too many concurrent pushes to ${repoId}, please retry`);
  }
}

/** The index is a tombstone. Reads as absent, like a repository that never existed. */
export class RepositoryDeletedError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Repository not found');
  }
}

/** A ref the log must never hold: git refuses it on replay, so every node materializing the repository would stop at it for good. */
export class UnreplayableRefError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    readonly ref: string,
    reason: string,
  ) {
    super(`${ref} cannot be stored: ${reason}`);
  }
}
