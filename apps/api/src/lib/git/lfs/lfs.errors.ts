import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../../domain/errors.js';
import { formatByteSize } from '../../storage/byte-size.js';

export class LfsObjectNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('LFS object not found');
  }
}

export class InvalidLfsOidError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(oid: string) {
    super(`${oid} is not a SHA-256 object id`);
  }
}

export class LfsObjectTooLargeError extends DomainError {
  status: number = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(limit: number) {
    super(`An LFS object can be at most ${formatByteSize(limit)}`);
  }
}

export class LfsUploadInProgressError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(oid: string) {
    super(`Another upload of ${oid} is in progress`);
  }
}

export class LfsObjectMismatchError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(oid: string, actual: string) {
    super(`The uploaded bytes hash to ${actual}, not ${oid}`);
  }
}

export class LfsLockNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Lock not found');
  }
}

export class LfsLockForbiddenError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('Only the lock owner can unlock it, or an admin with force');
  }
}
