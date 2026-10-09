import { describe, expect, it } from 'vitest';

import { sliceConnection } from './connection.js';

describe('sliceConnection', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('pages forward with the endCursor it hands out', () => {
    const first = sliceConnection(items, { first: 2 });
    expect(first).toMatchObject({
      nodes: ['a', 'b'],
      totalCount: 5,
      pageInfo: { hasNextPage: true, hasPreviousPage: false },
    });
    const second = sliceConnection(items, {
      first: 2,
      after: first.pageInfo.endCursor,
    });
    expect(second).toMatchObject({
      nodes: ['c', 'd'],
      pageInfo: { hasNextPage: true, hasPreviousPage: true },
    });
    const last = sliceConnection(items, {
      first: 2,
      after: second.pageInfo.endCursor,
    });
    expect(last).toMatchObject({
      nodes: ['e'],
      pageInfo: { hasNextPage: false },
    });
  });

  it('takes the tail for last, and answers an empty list without a cursor', () => {
    expect(sliceConnection(items, { last: 2 })).toMatchObject({
      nodes: ['d', 'e'],
      pageInfo: { hasNextPage: false, hasPreviousPage: true },
    });
    expect(sliceConnection([], { first: 10 }).pageInfo).toMatchObject({
      hasNextPage: false,
      endCursor: null,
    });
  });

  it('treats a negative or garbage cursor as the start, and a negative page size as empty', () => {
    const cursor = (offset: string) =>
      Buffer.from(offset).toString('base64url');
    expect(
      sliceConnection(items, { first: 2, after: cursor('-2') }),
    ).toMatchObject({
      nodes: ['a', 'b'],
      pageInfo: { hasPreviousPage: false },
    });
    expect(
      sliceConnection(items, { first: 2, after: 'not-a-cursor' }).nodes,
    ).toEqual(['a', 'b']);
    expect(sliceConnection(items, { first: -1 }).nodes).toEqual([]);
    expect(sliceConnection(items, { last: -1 }).nodes).toEqual([]);
  });
});
