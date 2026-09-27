import { describe, expect, it } from 'vitest';

import { formatByteSize, parseByteSize } from './byte-size.js';

describe('parseByteSize', () => {
  it('reads blank as no limit', () => {
    expect(parseByteSize(undefined, 'X')).toBeNull();
    expect(parseByteSize('  ', 'X')).toBeNull();
  });

  it('reads plain bytes and binary units, ignoring case and spaces', () => {
    expect(parseByteSize('1073741824', 'X')).toBe(1024 ** 3);
    expect(parseByteSize('1gb', 'X')).toBe(1024 ** 3);
    expect(parseByteSize('500 MB', 'X')).toBe(500 * 1024 ** 2);
    expect(parseByteSize('1.5kb', 'X')).toBe(1536);
    expect(parseByteSize('0', 'X')).toBe(0);
  });

  it('throws on anything else, naming the setting', () => {
    for (const value of ['-1', '1 gigabyte', 'lots', '1e9']) {
      expect(() => parseByteSize(value, 'STORAGE_QUOTA_BYTES')).toThrow(
        /STORAGE_QUOTA_BYTES/,
      );
    }
  });
});

describe('formatByteSize', () => {
  it('picks the largest whole unit', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(1024 ** 3)).toBe('1 GB');
  });
});
