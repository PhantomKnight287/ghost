import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createGunzip, createInflate } from 'node:zlib';

import { spoolToFile } from '../../lib/git/protocol/spool.js';
import { GitAuthenticatedBufferedRequest } from '../types.js';

/** Spools the request to a temp file before anything awaits: an unattended stream drops whatever arrives meanwhile, and git sends its command section in its own socket write. Never buffered, since a push can be gigabytes. */
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
