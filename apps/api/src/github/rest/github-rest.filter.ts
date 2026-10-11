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
  GithubValidationError,
  InsufficientScopesError,
} from '../../lib/github/github.errors.js';
import {
  LabelAlreadyExistsError,
  PullRequestReopenError,
} from '../../lib/issues/issues.errors.js';

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
        : // GitHub refuses to reopen a merged pull request with 422, where Ghost says 409.
          exception instanceof PullRequestReopenError
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : exception.status;
    if (status >= 500) this.logger.error(exception);
    // GitHub says "Not Found" for every 404, so a private repository and a missing one read the same.
    const message = status === 404 ? 'Not Found' : this.messageOf(exception);
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

  /** GitHub answers a bad field with 422 "Validation Failed" naming it; ValidationPipe's 400 and Ghost's duplicate-label 409 become that. */
  private validationFailureOf(exception: DomainError | HttpException) {
    if (exception instanceof GithubValidationError) return exception;
    if (exception instanceof LabelAlreadyExistsError)
      return new GithubValidationError([
        { resource: 'Label', field: 'name', code: 'already_exists' },
      ]);
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

  private messageOf(exception: DomainError | HttpException) {
    const detail =
      exception instanceof HttpException ? this.detailOf(exception) : undefined;
    return typeof detail === 'string' ? detail : exception.message;
  }
}
