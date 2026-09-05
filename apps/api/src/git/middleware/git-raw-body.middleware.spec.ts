import { Readable } from 'node:stream';
import { buffer as readStream } from 'node:stream/consumers';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  GitRawBodyMiddleware,
  type GitRequest,
} from './git-raw-body.middleware.js';

function request(body: Buffer, headers: Record<string, string> = {}) {
  return Object.assign(Readable.from(body), {
    headers,
  }) as unknown as GitRequest;
}

describe('GitRawBodyMiddleware', () => {
  const middleware = new GitRawBodyMiddleware();
  const response = { on: () => {} } as never;

  it('spools the request before the handler runs', async () => {
    const req = request(Buffer.from('0032command\n0000PACK'));
    const next = vi.fn();

    await middleware.use(req, response, next);

    expect((await readStream(req.gitBody!.open())).toString()).toBe(
      '0032command\n0000PACK',
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('inflates a gzipped body', async () => {
    const raw = Buffer.from('0032command\n0000PACK');
    const req = request(gzipSync(raw), { 'content-encoding': 'gzip' });

    await middleware.use(req, response, vi.fn());

    expect(await readStream(req.gitBody!.open())).toEqual(raw);
  });

  it('passes a decode failure to the error handler', async () => {
    const req = request(Buffer.from('not gzip'), {
      'content-encoding': 'gzip',
    });
    const next = vi.fn();

    await middleware.use(req, response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
