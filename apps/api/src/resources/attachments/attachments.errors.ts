import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class AttachmentNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Attachment not found');
  }
}

export class AttachmentTooLargeError extends DomainError {
  status: number = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(limit: string) {
    super(`Attachments are limited to ${limit}`);
  }
}

export class AttachmentTypeNotAllowedError extends DomainError {
  status: number = HttpStatus.UNSUPPORTED_MEDIA_TYPE;

  constructor(name: string, allowed: string[]) {
    super(
      `${name} cannot be attached. Attach a file ending in ${allowed.join(', ')}, or zip it first`,
    );
  }
}

export class AttachmentNotOctetStreamError extends DomainError {
  status: number = HttpStatus.UNSUPPORTED_MEDIA_TYPE;

  constructor() {
    super(
      'Send the file as application/octet-stream; what it is served as follows from its name',
    );
  }
}
