import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';
import { MAX_ANNOTATIONS_PER_RUN, MAX_RUNS_PER_NAME } from './checks.js';

export class CheckRunConclusionRequiredError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('Conclusion is required when status is completed.');
  }
}

export class ActionRequiredNeedsDetailsUrlError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('Details URL is required when conclusion is action_required.');
  }
}

export class TooManyAnnotationsError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super(`A check run holds at most ${MAX_ANNOTATIONS_PER_RUN} annotations.`);
  }
}

export class TooManyCheckRunsError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(sha: string, name: string) {
    super(`${sha} already has ${MAX_RUNS_PER_NAME} check runs named ${name}`);
  }
}

export class CheckRunNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Check run not found');
  }
}

export class CheckSuiteNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Check suite not found');
  }
}

/** GitHub's answer to anything but an installation token creating or updating checks. */
export class ChecksNeedInstallationError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('You must authenticate via a GitHub App.');
  }
}

export class NotRunOwnerError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor(appId: number) {
    super(
      `Invalid app_id \`${appId}\` - check run can only be modified by the GitHub App that created it.`,
    );
  }
}

/** A re-run or button press on a run whose app was deleted, or whose installation is gone or suspended: nobody is left to hear it. */
export class CheckAppGoneError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('The app that owns this check is no longer installed here.');
  }
}

export class UnknownCheckActionError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(identifier: string) {
    super(`The check run has no action ${identifier}`);
  }
}
