import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createInflate } from 'node:zlib';

import { fileBody } from '../../lib/git/protocol/git-request-body.js';
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
    let directory: string | undefined;

    try {
      directory = await mkdtemp(path.join(tmpdir(), 'ghost-git-'));
      const file = path.join(directory, 'body');

      const written = createWriteStream(file);
      await pipeline(decode(req), written);

      req.gitBody = fileBody(file, written.bytesWritten);
      this.logger.debug(
        `${req.method} ${req.originalUrl} spooled=${written.bytesWritten}B ` +
          `content-length=${req.headers['content-length'] ?? '-'} ` +
          `content-encoding=${req.headers['content-encoding'] ?? '-'} ` +
          `transfer-encoding=${req.headers['transfer-encoding'] ?? '-'}`,
      );

      res.on('close', () => {
        rm(directory!, { recursive: true, force: true }).catch((error) =>
          this.logger.warn(`Failed to remove ${directory}: ${error}`),
        );
      });

      next();
    } catch (error) {
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch(() => {});
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
