import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';
import { formatByteSize } from './byte-size.js';

export class StorageQuotaExceededError extends DomainError {
  status: number = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(used: number, quota: number, requested: number) {
    super(
      `Storage quota exceeded: ${formatByteSize(used)} of ${formatByteSize(quota)} used, and this file needs ${formatByteSize(requested)}`,
    );
  }
}
