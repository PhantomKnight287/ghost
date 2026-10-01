import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class GitHubImportsDisabledError extends DomainError {
  status: number = HttpStatus.NOT_IMPLEMENTED;

  constructor() {
    super('GitHub imports are not configured on this instance');
  }
}

export class GitHubNotConnectedError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('Connect your GitHub account before importing a repository');
  }
}

export class GitHubRepositoryNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(source: string) {
    super(
      `GitHub repository ${source} was not found, or your GitHub account cannot read it`,
    );
  }
}

export class GitHubUnavailableError extends DomainError {
  status: number = HttpStatus.BAD_GATEWAY;

  constructor(options: { cause: unknown }) {
    super('GitHub could not be reached, try again shortly', options);
  }
}

export class ImportNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('This repository was not imported');
  }
}

export class ImportNotFailedError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('Only a failed import can be retried');
  }
}

/** The API moved on to another attempt, or the import is gone; the importer stops when it sees this. */
export class StaleImportAttemptError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('This import attempt is no longer current');
  }
}

/** A retry writes GitHub's issue numbers over whatever holds them, so it is refused once people have opened issues of their own. */
export class ImportRetryWouldOverwriteError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super(
      'Issues or pull requests were opened here after the import failed, and retrying it would overwrite them',
    );
  }
}

export class RepositoryImportingError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('This repository is still being imported from GitHub');
  }
}

export class ImporterUnavailableError extends Error {
  constructor(options: { cause: unknown }) {
    super('The importer did not accept the job', options);
  }
}
