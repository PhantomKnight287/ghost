import { describe, expect, it } from 'vitest';

import { parseLfsPointer } from './lfs-pointer.js';

const OID = 'a'.repeat(64);

describe('parseLfsPointer', () => {
  it('reads the oid and size, past extension keys', () => {
    const pointer = `version https://git-lfs.github.com/spec/v1\next-0-foo sha256:${'b'.repeat(64)}\noid sha256:${OID}\nsize 12345\n`;
    expect(parseLfsPointer(Buffer.from(pointer))).toEqual({
      oid: OID,
      size: 12345,
    });
  });

  it.each([
    ['an ordinary file', 'hello\n'],
    [
      'a pointer missing its size',
      `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\n`,
    ],
    [
      'a file past the pointer limit',
      `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 1\n${'x'.repeat(1024)}`,
    ],
  ])('returns null for %s', (_, content) => {
    expect(parseLfsPointer(Buffer.from(content))).toBeNull();
  });
});
