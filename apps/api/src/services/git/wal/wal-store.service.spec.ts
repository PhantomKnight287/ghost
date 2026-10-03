import { describe, expect, it } from 'vitest';

import { text } from 'node:stream/consumers';
import type { Readable } from 'node:stream';

import { S3Service } from '../../s3/s3.service.js';
import {
  ENTRY_HEADER_PROBE_BYTES,
  encodeEntryHeader,
} from '../../../lib/git/wal/wal-codec.js';
import { createUlid } from '../../../lib/git/wal/ulid.js';
import { WalStoreService } from './wal-store.service.js';

/** Serves one stored object, honouring `Range: bytes=start-end` the way S3 does. */
function rangedS3(object: Buffer) {
  return {
    bucket: 'test',
    getObject: ({ Range }: { Range: string }) => {
      const [, start, end] = /^bytes=(\d+)-(\d*)$/.exec(Range)!;
      const slice = object.subarray(
        Number(start),
        end ? Number(end) + 1 : undefined,
      );
      return Promise.resolve({
        Body: Object.assign(
          (async function* () {
            yield slice;
          })(),
          { transformToByteArray: () => Promise.resolve(slice) },
        ),
      });
    },
  } as unknown as S3Service;
}

describe('WalStoreService', () => {
  it('reads an entry whose header is longer than the probe', async () => {
    const ulid = createUlid();
    const transitions = Array.from({ length: 2000 }, (_, i) => ({
      ref: `refs/heads/some/long/branch/name/${i}`,
      oldOid: Buffer.alloc(20, 0),
      newOid: Buffer.alloc(20, 1),
    }));
    const header = encodeEntryHeader({
      ulid,
      createdAt: 1_700_000_000_000,
      pushedBy: null,
      transitions,
    });
    expect(header.length).toBeGreaterThan(ENTRY_HEADER_PROBE_BYTES);
    const store = new WalStoreService(
      rangedS3(Buffer.concat([header, Buffer.from('PACKDATA')])),
    );

    const read = await store.readEntryHeader('repo', ulid);
    const pack = await store.openEntryPack('repo', ulid);

    expect(read?.transitions).toHaveLength(2000);
    expect(await text(pack as Readable)).toBe('PACKDATA');
  });
});
