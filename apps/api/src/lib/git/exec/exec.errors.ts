import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../domain/errors.js';

export class GitCommandFailedError extends DomainError {
  status: number = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    // Some commands report a failure on stdout, such as `merge-tree` listing the conflicted paths.
    readonly stdout = '',
  ) {
    super(`git ${command} exited with ${exitCode}: ${stderr}`);
  }
}
