import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

import { DomainError } from '../../domain/errors.js';

const DOCUMENTATION_URL = 'https://docs.github.com/rest';

/** GitHub's REST error body, `{ message, documentation_url }`, for the compat controllers only; Ghost's own routes keep DomainErrorFilter. */
@Catch(DomainError, HttpException)
export class GithubRestFilter implements ExceptionFilter<DomainError | HttpException> {
  private readonly logger = new Logger(GithubRestFilter.name);

  catch(exception: DomainError | HttpException, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : exception.status;
    if (status >= 500) this.logger.error(exception);
    // GitHub says "Not Found" for every 404, so a private repository and a missing one read the same.
    const message = status === 404 ? 'Not Found' : exception.message;
    host.switchToHttp().getResponse<Response>().status(status).json({ message, documentation_url: DOCUMENTATION_URL });
  }
}
