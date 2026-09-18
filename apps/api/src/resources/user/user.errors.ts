import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class UnsupportedAvatarTypeError extends DomainError {
  status: number = HttpStatus.UNSUPPORTED_MEDIA_TYPE;

  constructor(contentType: string) {
    super(`Unsupported avatar content type: ${contentType || 'none'}`);
  }
}

export class EmptyAvatarError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('Avatar upload has no body');
  }
}

export class AvatarNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Avatar not found');
  }
}
