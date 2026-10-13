import { once } from 'node:events';
import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import type { Logger } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArchiveFormat, SourceArchive } from '../git/archive/archive.js';
import { sendArchive } from './send-archive.js';

const commit = 'a'.repeat(40);

describe('sendArchive', () => {
  let sent: Promise<void>;
  let server: Server | undefined;
  const logger = { warn: vi.fn() };

  afterEach(() => {
    logger.warn.mockClear();
    server?.close();
    server = undefined;
  });

  function serve(archive: SourceArchive, format: ArchiveFormat = 'zip') {
    const app = express();
    app.get('/', (req, res, next) => {
      sent = sendArchive(res, archive, {
        format,
        ifNoneMatch: req.get('if-none-match'),
        logger: logger as unknown as Logger,
      }).catch(next);
    });
    return app;
  }

  const archive = (
    open: () => Readable,
    immutable = true,
    size?: number,
  ): SourceArchive => ({
    commit,
    immutable,
    filename: 'ghost-v1.0.zip',
    open: vi.fn(async () => ({ stream: open(), size })),
  });

  it('streams a tag as an attachment the browser may keep', async () => {
    const response = await request(serve(archive(() => Readable.from(['PK']))))
      .get('/')
      .expect(200);

    expect(response.headers).toMatchObject({
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="ghost-v1.0.zip"',
      etag: `"${commit}-zip"`,
      'cache-control': 'private, max-age=31536000, immutable',
    });
    expect(response.text).toBe('PK');
  });

  it('declares the length of an archive already stored', async () => {
    await request(serve(archive(() => Readable.from(['PK']), true, 2)))
      .get('/')
      .expect(200)
      .expect('content-length', '2');
  });

  it('has a branch revalidated, since it moves', async () => {
    const response = await request(
      serve(
        archive(() => Readable.from(['gz']), false),
        'tar.gz',
      ),
    )
      .get('/')
      .expect(200);

    expect(response.headers['content-type']).toBe('application/gzip');
    expect(response.headers['cache-control']).toBe('private, no-cache');
  });

  it('answers a matching If-None-Match with 304 without building the archive', async () => {
    const tag = archive(() => Readable.from(['PK']));
    await request(serve(tag))
      .get('/')
      .set('if-none-match', `"${commit}-zip"`)
      .expect(304)
      .expect('etag', `"${commit}-zip"`);

    expect(tag.open).not.toHaveBeenCalled();
  });

  it('marks nothing cacheable when the archive cannot be opened', async () => {
    const busy = archive(() => {
      throw new Error('busy');
    });
    const response = await request(serve(busy)).get('/').expect(500);

    expect(response.headers['cache-control']).toBeUndefined();
    expect(response.headers.etag).toBeUndefined();
  });

  it('breaks the connection and logs when git fails partway', async () => {
    const failing = archive(
      () =>
        new Readable({
          read() {
            this.push('PK');
            this.destroy(new Error('git died'));
          },
        }),
    );

    await expect(request(serve(failing)).get('/')).rejects.toThrow();
    await sent;
    expect(logger.warn).toHaveBeenCalledWith(
      'Archive ghost-v1.0.zip failed: git died',
    );
  });

  it('logs nothing when the client stops downloading', async () => {
    const endless = archive(
      () =>
        new Readable({
          read() {
            this.push('PK');
          },
        }),
    );
    server = serve(endless).listen(0);
    await once(server, 'listening');

    const { port } = server.address() as AddressInfo;
    const client = get(`http://127.0.0.1:${port}/`);
    const [response] = await once(client, 'response');
    response.destroy();
    client.destroy();

    await sent;
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
