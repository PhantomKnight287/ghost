import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { DomainError } from '../../domain/errors.js';
import {
  InvalidStatusShaError,
  TooManyStatusesError,
} from '../../lib/commit-statuses/commit-statuses.errors.js';
import {
  GithubValidationError,
  InsufficientScopesError,
  NoCommitFoundError,
  type ValidationFailure,
} from '../../lib/github/github.errors.js';
import {
  LabelAlreadyExistsError,
  PullRequestReopenError,
} from '../../lib/issues/issues.errors.js';
import {
  EmptyReviewError,
  InvalidLineRangeError,
  OwnPullRequestReviewError,
  PullRequestNotOpenError,
  ReviewLineNotInDiffError,
} from '../../lib/pull-requests/pull-requests.errors.js';
import {
  InvalidAssetNameError,
  InvalidTagNameError,
  ReleaseAlreadyExistsError,
  ReleaseAssetExistsError,
  TagTargetNotFoundError,
} from '../../lib/releases/releases.errors.js';

/** Ghost errors GitHub answers as a 422 naming the field at fault. */
const FIELD_ERRORS: [
  new (...args: never[]) => DomainError,
  ValidationFailure,
][] = [
  [
    LabelAlreadyExistsError,
    { resource: 'Label', field: 'name', code: 'already_exists' },
  ],
  [
    ReleaseAlreadyExistsError,
    { resource: 'Release', field: 'tag_name', code: 'already_exists' },
  ],
  [
    InvalidTagNameError,
    { resource: 'Release', field: 'tag_name', code: 'invalid' },
  ],
  [
    TagTargetNotFoundError,
    { resource: 'Release', field: 'target_commitish', code: 'invalid' },
  ],
  [
    ReleaseAssetExistsError,
    { resource: 'ReleaseAsset', field: 'name', code: 'already_exists' },
  ],
  [
    InvalidAssetNameError,
    { resource: 'ReleaseAsset', field: 'name', code: 'invalid' },
  ],
  [
    InvalidStatusShaError,
    { resource: 'Status', field: 'sha', code: 'invalid' },
  ],
  [
    TooManyStatusesError,
    { resource: 'Status', field: 'context', code: 'invalid' },
  ],
];

/** Ghost errors GitHub answers as a plain 422, where Ghost says 400 or 409. */
const UNPROCESSABLE: (new (...args: never[]) => DomainError)[] = [
  PullRequestReopenError,
  ReviewLineNotInDiffError,
  InvalidLineRangeError,
  OwnPullRequestReviewError,
  EmptyReviewError,
  PullRequestNotOpenError,
];

const DOCUMENTATION_URL = 'https://docs.github.com/rest';

/** GitHub's REST error body, `{ message, documentation_url, status }` plus `errors` on a 422, for the compat controllers only; Ghost's own routes keep DomainErrorFilter. */
@Catch(DomainError, HttpException)
export class GithubRestFilter
  implements ExceptionFilter<DomainError | HttpException>
{
  private readonly logger = new Logger(GithubRestFilter.name);

  catch(exception: DomainError | HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const failed = this.validationFailureOf(exception);
    if (failed) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        message: failed.message,
        errors: failed.errors,
        documentation_url: DOCUMENTATION_URL,
        status: String(HttpStatus.UNPROCESSABLE_ENTITY),
      });
      return;
    }
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : UNPROCESSABLE.some((type) => exception instanceof type)
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : exception.status;
    if (status >= 500) this.logger.error(exception);
    // GitHub says "Not Found" for every 404 but a missing commit, so a private repository and a missing one read the same.
    const detail =
      exception instanceof HttpException ? this.detailOf(exception) : undefined;
    const message =
      status === 404 && !(exception instanceof NoCommitFoundError)
        ? 'Not Found'
        : typeof detail === 'string'
          ? detail
          : exception.message;
    if (exception instanceof InsufficientScopesError)
      response.setHeader(
        'X-Accepted-OAuth-Scopes',
        exception.accepted.join(', '),
      );
    response.status(status).json({
      message,
      documentation_url: DOCUMENTATION_URL,
      status: String(status),
    });
  }

  /** GitHub answers a bad field with 422 "Validation Failed" naming it; ValidationPipe's 400 and the Ghost errors in FIELD_ERRORS become that. */
  private validationFailureOf(exception: DomainError | HttpException) {
    if (exception instanceof GithubValidationError) return exception;
    const field = FIELD_ERRORS.find(([type]) => exception instanceof type);
    if (field) return new GithubValidationError([field[1]]);
    const detail =
      exception instanceof BadRequestException
        ? this.detailOf(exception)
        : undefined;
    if (!Array.isArray(detail)) return null;
    return {
      message: 'Validation Failed',
      // class-validator starts each message with the property it is about.
      errors: detail.map((line: string) => ({
        field: line.split(' ')[0],
        code: 'invalid',
        message: line,
      })),
    };
  }

  private detailOf(exception: HttpException) {
    const response = exception.getResponse();
    return typeof response === 'object' &&
      response !== null &&
      'message' in response
      ? response.message
      : undefined;
  }
}
