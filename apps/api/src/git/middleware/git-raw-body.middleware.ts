import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createGunzip, createInflate } from 'node:zlib';

import { spoolToFile } from '../../lib/git/protocol/spool.js';
import { GitAuthenticatedBufferedRequest } from '../types.js';

/**
 * Spools the request to a temp file before guards, pipes or handlers get a chance to await anything.
 *
 * Middleware, not a handler: an unattended stream drops whatever arrives while the handler is busy, and git sends its command section in its own socket write. A push can also be gigabytes, so it is never buffered.
 */
@Injectable()
export class GitRawBodyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GitRawBodyMiddleware.name);

  async use(
    req: GitAuthenticatedBufferedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const spooled = await spoolToFile(decode(req));

      req.gitBody = spooled.body;
      this.logger.debug(
        `${req.method} ${req.originalUrl} spooled=${spooled.body.size}B content-length=${req.headers['content-length'] ?? '-'} content-encoding=${req.headers['content-encoding'] ?? '-'} transfer-encoding=${req.headers['transfer-encoding'] ?? '-'}`,
      );

      res.on('close', () => {
        spooled
          .discard()
          .catch((error: unknown) =>
            this.logger.warn(`Failed to remove the spooled body: ${error}`),
          );
      });

      next();
    } catch (error) {
      next(error);
    }
  }
}

function decode(req: Request) {
  switch (req.headers['content-encoding']?.toLowerCase()) {
    case 'gzip':
      return req.pipe(createGunzip());
    case 'deflate':
      return req.pipe(createInflate());
    default:
      return req;
  }
}
