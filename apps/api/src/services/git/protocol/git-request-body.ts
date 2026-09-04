import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

/**
 * A request body that can be read more than once and never has to exist in
 * memory all at once. Push bodies routinely exceed the 2 GiB ceiling on a single
 * Buffer operation, so nothing downstream may assume a Buffer.
 */
export interface GitRequestBody {
  readonly size: number;
  open(start?: number): Readable;
}

export function bufferBody(buffer: Buffer): GitRequestBody {
  return {
    size: buffer.length,
    open: (start = 0) => Readable.from(buffer.subarray(start)),
  };
}

export function fileBody(path: string, size: number): GitRequestBody {
  return {
    size,
    open: (start = 0) => createReadStream(path, { start }),
  };
}

/** Emits `header`, then everything `body` holds from `start` onward. */
export function prefixed(header: Buffer, body: GitRequestBody, start = 0) {
  return Readable.from(
    (async function* () {
      yield header;
      yield* body.open(start);
    })(),
  );
}

export async function readHead(body: GitRequestBody, limit: number) {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of body.open(0)) {
    chunks.push(chunk as Buffer);
    length += (chunk as Buffer).length;
    if (length >= limit) break;
  }

  return Buffer.concat(chunks, Math.min(length, limit));
}
