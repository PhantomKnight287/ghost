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

export class PullRefWriteTooLargeError extends DomainError {
  status: number = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(requested: number, limit: number) {
    super(
      `A pull request's head added ${formatByteSize(requested)} to its base repository, past the ${formatByteSize(limit)} one update may add`,
    );
  }
}

export class UnmergedPullRefQuotaExceededError extends DomainError {
  status: number = HttpStatus.PAYLOAD_TOO_LARGE;

  constructor(used: number, limit: number, requested: number) {
    super(
      `Unmerged pull requests by this author already hold ${formatByteSize(used)} of ${formatByteSize(limit)} in other repositories, and this update needs ${formatByteSize(requested)}`,
    );
  }
}
