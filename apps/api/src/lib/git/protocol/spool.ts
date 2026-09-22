import { createWriteStream, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fileBody, type GitRequestBody } from './git-request-body.js';

export interface SpooledBody {
  body: GitRequestBody;
  /** Removes the temp directory. Safe to call twice. */
  discard(): Promise<void>;
}

/** Writes a request to a temp file so it can be read twice - once to parse the ref commands, once to feed git - without ever holding a packfile in memory. */
export async function spoolToFile(input: Readable): Promise<SpooledBody> {
  // Synchronous on purpose: the caller has already started the stream, and an await here loses whatever arrives - or errors - before the pipeline is attached.
  const directory = mkdtempSync(path.join(tmpdir(), 'ghost-git-'));

  try {
    const file = path.join(directory, 'body');
    const written = createWriteStream(file);
    await pipeline(input, written);

    return {
      body: fileBody(file, written.bytesWritten),
      discard: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
