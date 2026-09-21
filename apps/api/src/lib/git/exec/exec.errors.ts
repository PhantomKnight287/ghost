import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../domain/errors.js';

export class GitCommandFailedError extends DomainError {
  status: number = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${command} exited with ${exitCode}: ${stderr}`);
  }
}
