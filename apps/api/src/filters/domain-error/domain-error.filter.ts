import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DomainError } from '../../domain/errors.js';

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: DomainError, host: ArgumentsHost) {
    // A 4xx is an expected answer; a 5xx is ours to look into.
    if (exception.status >= 500) this.logger.error(exception);
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    response.status(exception.status).json({
      statusCode: exception.status,
      error: exception.name,
      message: exception.message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
