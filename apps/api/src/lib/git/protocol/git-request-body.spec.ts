import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';

import { bufferBody } from './git-request-body.js';

describe('bufferBody', () => {
  it('reads from an offset as a single chunk', async () => {
    const body = bufferBody(Buffer.from('header-pack'));
    await expect(buffer(body.open(7))).resolves.toEqual(Buffer.from('pack'));
    expect(await body.open(0).toArray()).toHaveLength(1);
  });

  it('emits no chunk at all when nothing is left to read', async () => {
    expect(await bufferBody(Buffer.alloc(0)).open().toArray()).toEqual([]);
    expect(await bufferBody(Buffer.from('ab')).open(2).toArray()).toEqual([]);
  });
});
