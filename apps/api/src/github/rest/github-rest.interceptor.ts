import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map } from 'rxjs';

import { githubOrigins } from '../../lib/github/origins.js';
import { linkHeader, RestPage } from '../../lib/github/rest.js';

/** What every GitHub REST response carries beyond its body: the `Link` header of a paged list, and the `Location` of what a 201 created. */
@Injectable()
export class GithubRestInterceptor implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const created =
      request.method === 'POST' &&
      (this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
        201) === 201;
    return next.handle().pipe(
      map((result: unknown) => {
        if (result instanceof RestPage) {
          const url = new URL(
            request.originalUrl,
            githubOrigins(this.config).api,
          );
          const link = linkHeader(url, result.page, result.total);
          if (link) response.setHeader('Link', link);
          return result.items;
        }
        if (
          created &&
          typeof result === 'object' &&
          result !== null &&
          'url' in result &&
          typeof result.url === 'string'
        )
          response.setHeader('Location', result.url);
        return result;
      }),
    );
  }
}
