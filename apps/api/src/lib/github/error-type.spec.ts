import { describe, expect, it } from 'vitest';

import { graphqlErrorType } from './error-type.js';

describe('graphqlErrorType', () => {
  it.each([
    [404, 'NOT_FOUND'],
    [401, 'FORBIDDEN'],
    [403, 'FORBIDDEN'],
    [400, 'UNPROCESSABLE'],
    [409, 'UNPROCESSABLE'],
    [422, 'UNPROCESSABLE'],
    [500, 'INTERNAL'],
  ])('maps %i to %s', (status, type) => {
    expect(graphqlErrorType(status)).toBe(type);
  });
});
