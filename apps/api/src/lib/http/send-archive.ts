import { HttpStatus, type Logger } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';

import {
  ARCHIVE_MEDIA_TYPES,
  type ArchiveFormat,
  type SourceArchive,
} from '../git/archive/archive.js';

/** Writes a source archive to the response itself, for Ghost's route and GitHub's alike: Nest would reset a returned 304 to the route's 200. */
export async function sendArchive(
  response: Response,
  archive: SourceArchive,
  {
    format,
    ifNoneMatch,
    logger,
  }: { format: ArchiveFormat; ifNoneMatch?: string; logger: Logger },
) {
  const caching = {
    ETag: `"${archive.commit}-${format}"`,
    // a branch is revalidated, which costs a rev-parse, not a rebuild
    'Cache-Control': archive.immutable
      ? 'private, max-age=31536000, immutable'
      : 'private, no-cache',
  };
  // A list of entity tags, compared weakly as RFC 9110 has If-None-Match compared; `*` matches any archive there is.
  const candidates = ifNoneMatch?.match(/\*|(?:W\/)?"[^"]*"/g) ?? [];
  if (
    candidates.some(
      (candidate) =>
        candidate === '*' || candidate.replace(/^W\//, '') === caching.ETag,
    )
  ) {
    response.set(caching).status(HttpStatus.NOT_MODIFIED).end();
    return;
  }

  // opened before any header is set, so a busy 503 is never marked cacheable
  const { stream, size } = await archive.open();
  response.set({
    ...caching,
    'Content-Type': ARCHIVE_MEDIA_TYPES[format],
    'Content-Disposition': `attachment; filename="${encodeURIComponent(archive.filename)}"`,
    ...(size !== undefined && { 'Content-Length': String(size) }),
  });
  // Without a Content-Length nothing betrays a short body: a failing git has to break the connection, and pipeline does, as it stops git when the client goes away.
  await pipeline(stream, response).catch((error: NodeJS.ErrnoException) => {
    // a client that stops downloading is not a failure
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    logger.warn(`Archive ${archive.filename} failed: ${error.message}`);
  });
}
