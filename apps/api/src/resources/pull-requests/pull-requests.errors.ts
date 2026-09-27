import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class PullRequestNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Pull request not found');
  }
}

export class PullRequestAlreadyOpenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(number: number) {
    super(`These branches already have an open pull request: #${number}`);
  }
}

export class SameBranchPullRequestError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('A pull request cannot merge a branch into itself');
  }
}

export class UnrelatedHistoriesError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('These branches share no common history');
  }
}

export class PullRequestNotOpenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(state: string) {
    super(`This pull request is ${state}`);
  }
}

export class PullRequestConflictError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('This pull request has conflicts that must be resolved locally');
  }
}

export class NothingToMergeError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('The base branch already contains every commit from the head branch');
  }
}

export class UnrelatedRepositoriesError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super(
      'A pull request must come from the repository itself or a fork of it',
    );
  }
}

/** A closed request whose head repository was deleted: its commits went with it. */
export class PullRequestHeadDeletedError extends DomainError {
  status: number = HttpStatus.GONE;

  constructor() {
    super(
      'The repository this pull request came from was deleted, and its changes with it',
    );
  }
}

export class PullRequestDraftError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super(
      'This pull request is a draft; mark it ready for review before merging',
    );
  }
}

export class OwnPullRequestReviewError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('You cannot approve or request changes on your own pull request');
  }
}

export class EmptyReviewError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('A comment review needs a body or at least one line comment');
  }
}

export class ReviewLineNotInDiffError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(path: string, line: number) {
    super(`${path}:${line} is not part of this pull request's diff`);
  }
}

export class InvalidLineRangeError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('A comment on several lines must start before it ends');
  }
}

export class SuggestionOutdatedError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super(
      'The branch has moved on since this suggestion was made, so it no longer applies',
    );
  }
}

export class SuggestionNotApplicableError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(reason: string) {
    super(reason);
  }
}

export class ReviewNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Review not found');
  }
}

export class ReviewCommentNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Review comment not found');
  }
}

export class ReviewNotDismissableError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super(
      'Only an approval or a request for changes that still counts can be dismissed',
    );
  }
}

export class PendingReviewReplyError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor() {
    super('Submit your review before replying to its comments');
  }
}
