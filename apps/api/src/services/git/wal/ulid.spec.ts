import { describe, expect, it } from 'vitest';

import { bytesToUlid, createUlid, ulidToBytes } from './ulid.js';

describe('ulid', () => {
  it('round-trips through its 16-byte form', () => {
    const ulid = createUlid();

    expect(ulid).toHaveLength(26);
    expect(ulidToBytes(ulid)).toHaveLength(16);
    expect(bytesToUlid(ulidToBytes(ulid))).toBe(ulid);
  });

  it('sorts lexicographically by creation time', () => {
    const earlier = createUlid(1_700_000_000_000);
    const later = createUlid(1_700_000_001_000);

    expect(earlier < later).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(() => ulidToBytes('nope')).toThrow(TypeError);
    expect(() => bytesToUlid(Buffer.alloc(8))).toThrow(TypeError);
  });
});
