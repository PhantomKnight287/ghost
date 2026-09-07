import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PushTransactionService } from './push-transaction.service.js';
import { WalStoreService } from './wal-store.service.js';
import { NonFastForwardError } from './wal.errors.js';
import { emptyIndex, type RefTransition, type WalIndex } from './wal.types.js';
import { Readable } from 'node:stream';

import {
  bufferBody,
  type GitRequestBody,
} from '../protocol/git-request-body.js';

const oid = (byte: number) => Buffer.alloc(20, byte);
const PACK_OFFSET = 8;
const body = bufferBody(
  Buffer.concat([Buffer.from('00000000'), Buffer.from('PACKDATA')]),
);

function transition(oldByte: number, newByte: number): RefTransition {
  return { ref: 'refs/heads/main', oldOid: oid(oldByte), newOid: oid(newByte) };
}

describe('PushTransactionService', () => {
  let service: PushTransactionService;
  const store = {
    putEntry: vi.fn().mockResolvedValue(undefined),
    readIndex: vi.fn(),
    casIndex: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushTransactionService,
        { provide: WalStoreService, useValue: store },
      ],
    }).compile();

    service = module.get(PushTransactionService);
  });

  it('creates the index on a first push', async () => {
    store.readIndex.mockResolvedValue(null);
    store.casIndex.mockResolvedValue(true);

    const result = await service.commitPush({
      repoId: 'phantomknight287/ghost',
      transitions: [transition(0, 0xaa)],
      body,
      packOffset: PACK_OFFSET,
    });

    expect(result.seq).toBe(1);
    expect(store.casIndex).toHaveBeenCalledWith(
      'phantomknight287/ghost',
      expect.objectContaining({ seq: 1 }),
      null,
    );
  });

  it('uploads the pack once and reuses it across CAS retries', async () => {
    const first: WalIndex = {
      ...emptyIndex(),
      seq: 5,
      refs: new Map([['refs/heads/main', oid(0xaa)]]),
    };
    const second: WalIndex = { ...first, seq: 6 };
    store.readIndex
      .mockResolvedValueOnce({ index: first, etag: '"one"' })
      .mockResolvedValueOnce({ index: second, etag: '"two"' });
    store.casIndex.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await service.commitPush({
      repoId: 'phantomknight287/ghost',
      transitions: [transition(0xaa, 0xbb)],
      body,
      packOffset: PACK_OFFSET,
    });

    expect(result.seq).toBe(7);
    expect(store.putEntry).toHaveBeenCalledTimes(1);
  });

  it('hashes a packfile larger than the 2 GiB Buffer ceiling', async () => {
    store.readIndex.mockResolvedValue(null);
    store.casIndex.mockResolvedValue(true);

    const chunk = Buffer.alloc(1024 * 1024, 0x5a);
    const chunks = 2200; // 2.15 GiB - past INT_MAX, where Hash.update throws
    const huge: GitRequestBody = {
      size: chunk.length * chunks,
      open: () =>
        Readable.from(
          (function* () {
            for (let i = 0; i < chunks; i++) yield chunk;
          })(),
        ),
    };

    const result = await service.commitPush({
      repoId: 'phantomknight287/ghost',
      transitions: [transition(0, 0xaa)],
      body: huge,
      packOffset: 0,
    });

    expect(result.seq).toBe(1);
    expect(store.casIndex.mock.calls[0][1].layers[0].size).toBe(huge.size);
  }, 120_000);

  it('rejects a stale ref instead of clobbering it', async () => {
    store.readIndex.mockResolvedValue({
      index: {
        ...emptyIndex(),
        seq: 3,
        refs: new Map([['refs/heads/main', oid(0xff)]]),
      },
      etag: '"three"',
    });

    await expect(
      service.commitPush({
        repoId: 'phantomknight287/ghost',
        transitions: [transition(0xaa, 0xbb)],
        body,
        packOffset: PACK_OFFSET,
      }),
    ).rejects.toBeInstanceOf(NonFastForwardError);
    expect(store.casIndex).not.toHaveBeenCalled();
  });

  it('treats an already-recorded entry as committed', async () => {
    store.readIndex.mockImplementation(async () => ({
      index: {
        ...emptyIndex(),
        seq: 9,
        refs: new Map([['refs/heads/main', oid(0xbb)]]),
        layers: [
          {
            ulid: store.putEntry.mock.calls[0][1],
            packSha: Buffer.alloc(32),
            size: body.size - PACK_OFFSET,
          },
        ],
      },
      etag: '"nine"',
    }));

    const result = await service.commitPush({
      repoId: 'phantomknight287/ghost',
      transitions: [transition(0xaa, 0xbb)],
      body,
      packOffset: PACK_OFFSET,
    });

    expect(result.seq).toBe(1);
    expect(store.casIndex).not.toHaveBeenCalled();
  });
});
