import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';

import { runGit, runGitReadable, runGitStream } from './run-git.js';

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

describe('runGitReadable', () => {
  it('errors the stream when git fails, rather than ending it as if complete', async () => {
    const stream = runGitReadable({
      args: ['cat-file', 'blob', 'HEAD'],
      gitDir: tmpdir(),
    });
    await expect(text(stream)).rejects.toThrow();
  });

  it('errors the stream when git cannot be started', async () => {
    const stream = runGitReadable({
      args: ['version'],
      gitDir: tmpdir(),
      env: { PATH: '' },
    });
    await expect(text(stream)).rejects.toThrow(/ENOENT/);
  });

  it('kills git when the consumer stops reading', async () => {
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    // a daemon writes nothing and never exits on its own
    const stream = runGitReadable({
      args: [
        'daemon',
        '--listen=127.0.0.1',
        '--port=0',
        `--base-path=${tmpdir()}`,
      ],
      gitDir: tmpdir(),
    });
    stream.destroy();
    await once(stream, 'close');
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    kill.mockRestore();
  });
});
