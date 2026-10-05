import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { SearchCodeQueryDTO } from './search-code.dto.js';

/** Mirrors what the global `ValidationPipe({ transform: true })` does to `req.query`. */
async function validateQuery(query: Record<string, unknown>) {
  return validate(plainToInstance(SearchCodeQueryDTO, query));
}

describe('SearchCodeQueryDTO', () => {
  it('treats an empty cursor as absent', async () => {
    expect(await validateQuery({ q: 'x', cursor: '' })).toEqual([]);
  });

  it('accepts a numeric cursor', async () => {
    expect(await validateQuery({ q: 'x', cursor: '20' })).toEqual([]);
  });

  it('rejects a cursor that is not a page offset', async () => {
    expect(await validateQuery({ q: 'x', cursor: 'abc' })).toHaveLength(1);
  });
});
