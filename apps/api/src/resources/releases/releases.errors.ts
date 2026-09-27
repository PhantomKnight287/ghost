import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class ReleaseNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Release not found');
  }
}

export class ReleaseAlreadyExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(tagName: string) {
    super(`A release already exists for the tag: ${tagName}`);
  }
}

export class InvalidTagNameError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(tagName: string) {
    super(`Not a valid tag name: ${tagName}`);
  }
}

export class TagTargetNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(target: string) {
    super(`Nothing to tag at: ${target}`);
  }
}

export class ReleaseAssetNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Release asset not found');
  }
}

export class ReleaseAssetExistsError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(name: string) {
    super(`This release already has an asset named: ${name}`);
  }
}

export class InvalidAssetNameError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(name: string) {
    super(`Not a valid file name: ${name}`);
  }
}

export class ReleaseAssetTooLargeError extends DomainError {
  status: number = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(limit: string) {
    super(`Release assets are limited to ${limit}`);
  }
}

export class ContentLengthRequiredError extends DomainError {
  status: number = HttpStatus.LENGTH_REQUIRED;

  constructor() {
    super('An upload must declare its Content-Length');
  }
}

export class UploadNotOctetStreamError extends DomainError {
  status: number = HttpStatus.UNSUPPORTED_MEDIA_TYPE;

  constructor() {
    super(
      'Send the file as application/octet-stream, and its own type as the `type` query parameter',
    );
  }
}
