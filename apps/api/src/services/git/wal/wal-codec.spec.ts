import { describe, expect, it } from 'vitest';

import {
  decodeEntryHeader,
  decodeIndex,
  encodeEntryHeader,
  encodeIndex,
} from './wal-codec.js';
import { createUlid } from './ulid.js';
import { WalCorruptError } from './wal.errors.js';
import type { WalIndex } from './wal.types.js';

const oid = (byte: number) => Buffer.alloc(20, byte);
const packSha = (byte: number) => Buffer.alloc(32, byte);

describe('wal-codec', () => {
  it('round-trips an index', () => {
    const ulid = createUlid();
    const index: WalIndex = {
      seq: 42,
      compactedThroughSeq: 7,
      refs: new Map([
        ['refs/heads/main', oid(0xab)],
        ['refs/tags/v1.0.0', oid(0xcd)],
      ]),
      layers: [{ ulid, packSha: packSha(0x11), size: 4096 }],
    };

    const decoded = decodeIndex(encodeIndex(index));

    expect(decoded.seq).toBe(42);
    expect(decoded.compactedThroughSeq).toBe(7);
    expect(decoded.refs.get('refs/heads/main')).toEqual(oid(0xab));
    expect(decoded.layers).toEqual(index.layers);
  });

  it('round-trips an empty index', () => {
    const decoded = decodeIndex(
      encodeIndex({
        seq: 0,
        compactedThroughSeq: 0,
        refs: new Map(),
        layers: [],
      }),
    );

    expect(decoded.seq).toBe(0);
    expect(decoded.refs.size).toBe(0);
    expect(decoded.layers).toHaveLength(0);
  });

  it('rejects a foreign buffer', () => {
    expect(() => decodeIndex(Buffer.alloc(64))).toThrow(WalCorruptError);
  });

  it('reports where the pack begins so headers can be read with a ranged GET', () => {
    const ulid = createUlid();
    const header = encodeEntryHeader({
      ulid,
      createdAt: 1_700_000_000_000,
      pushedBy: 'phantomknight287',
      transitions: [
        { ref: 'refs/heads/main', oldOid: oid(0), newOid: oid(0x22) },
      ],
    });
    const pack = Buffer.from('PACKDATA');

    const decoded = decodeEntryHeader(Buffer.concat([header, pack]));

    expect(decoded.packOffset).toBe(header.length);
    expect(decoded.header.ulid).toBe(ulid);
    expect(decoded.header.pushedBy).toBe('phantomknight287');
    expect(decoded.header.transitions[0].ref).toBe('refs/heads/main');
  });

  it('stores oids as raw bytes rather than hex', () => {
    const encoded = encodeIndex({
      seq: 1,
      compactedThroughSeq: 0,
      refs: new Map([['refs/heads/main', oid(0xab)]]),
      layers: [],
    });

    expect(encoded.includes(Buffer.from('abab', 'utf8'))).toBe(false);
  });
});
