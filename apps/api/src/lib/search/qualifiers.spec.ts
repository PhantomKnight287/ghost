import { describe, expect, it } from 'vitest';

import { ownerQualifier } from './qualifiers.js';

describe('ownerQualifier', () => {
  it('takes the owner out of the query', () => {
    expect(ownerQualifier('org:acme parser')).toEqual({
      owner: 'acme',
      rest: 'parser',
    });
    expect(ownerQualifier('parser user:alice  lexer')).toEqual({
      owner: 'alice',
      rest: 'parser lexer',
    });
  });

  it('leaves a query without one alone', () => {
    expect(ownerQualifier('  parser  ')).toEqual({
      owner: null,
      rest: 'parser',
    });
  });

  it('lets the last qualifier win', () => {
    expect(ownerQualifier('org:acme org:ghost')).toEqual({
      owner: 'ghost',
      rest: '',
    });
  });
});
