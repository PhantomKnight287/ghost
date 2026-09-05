import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { GetRepositoryContentsQueryDTO } from './get-repository-contents.dto.js';

/**
 * Mirrors what the global `ValidationPipe({ transform: true })` does to
 * `req.query`, whose values Express has already percent-decoded once.
 */
async function validateQuery(query: Record<string, unknown>) {
  return validate(plainToInstance(GetRepositoryContentsQueryDTO, query));
}

describe('GetRepositoryContentsQueryDTO', () => {
  it('accepts an omitted path', async () => {
    expect(await validateQuery({})).toEqual([]);
  });

  it('accepts a repository-relative directory', async () => {
    // what "?path=src%2Fdeep" looks like by the time it reaches the pipe
    expect(await validateQuery({ path: 'src/deep' })).toEqual([]);
  });

  it('rejects traversal, including the form that arrives from %2F', async () => {
    for (const path of ['..', '../etc/passwd', 'src/../../etc']) {
      const errors = await validateQuery({ path });
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('safeTreePath');
    }
  });

  it('rejects a NUL byte', async () => {
    expect(await validateQuery({ path: 'src\u0000' })).toHaveLength(1);
  });

  it('rejects a non-string path', async () => {
    // "?path=a&path=b" gives Express an array
    expect(await validateQuery({ path: ['a', 'b'] })).toHaveLength(1);
  });
});
