import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../domain/errors.js';

export class InvalidReceivePackRequestError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(detail: string, body?: Buffer) {
    super(
      `Malformed receive-pack request: ${detail}` +
        (body
          ? ` (${body.length} bytes, head=${body.subarray(0, 48).toString('hex')})`
          : ''),
    );
  }
}
