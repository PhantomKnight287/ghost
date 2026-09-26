import { HttpStatus } from '@nestjs/common';
import type { _Error } from '@aws-sdk/client-s3';

import { DomainError } from '../../domain/errors.js';

export function statusOf(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}

export function isNotFound(error: unknown) {
  return statusOf(error) === 404 || (error as Error)?.name === 'NoSuchKey';
}

export class S3DeleteError extends DomainError {
  status: number = HttpStatus.BAD_GATEWAY;

  constructor(prefix: string, errors: _Error[]) {
    super(
      `Object storage kept ${errors.length} object(s) under ${prefix}: ${errors[0].Code ?? 'unknown error'}`,
    );
  }
}
