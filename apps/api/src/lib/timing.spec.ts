import { describe, expect, it } from 'vitest';

import { timed, traced } from './timing.js';

describe('traced', () => {
  it('nests timed steps under the step that ran them', async () => {
    let tree = '';
    const result = await traced(
      () => timed('outer', () => timed('inner', async () => 42)),
      (report) => (tree = report),
    );

    expect(result).toBe(42);
    expect(tree).toMatch(
      /^total \d+ms\n  outer @\d+ms \d+ms\n    inner @\d+ms \d+ms$/,
    );
  });

  it('records nothing outside a trace', async () => {
    expect(await timed('alone', async () => 'ran')).toBe('ran');
  });
});
