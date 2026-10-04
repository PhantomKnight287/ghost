import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { runGit, runGitStream } from './run-git.js';

// More than a pipe buffer holds, handed to a git command that exits without reading stdin, so the write fails with EPIPE.
const unread = {
  args: ['version'],
  gitDir: tmpdir(),
  input: Buffer.alloc(8 << 20),
};

describe('git exiting before it reads its input', () => {
  it('leaves runGit with the exit status, not an unhandled EPIPE', async () => {
    expect(await runGit(unread)).toContain('git version');
  });

  it('leaves runGitStream with the exit status, not an unhandled EPIPE', async () => {
    let output = '';
    for await (const chunk of runGitStream(unread)) output += chunk;
    expect(output).toContain('git version');
  });
});
