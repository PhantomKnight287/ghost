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
