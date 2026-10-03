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

/** A push git would refuse, caught before the log commits it: once committed, every node replaying the repository would stop at it. */
export class PushRejectedError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(reason: string) {
    super(`Push rejected: ${reason}`);
  }
}
