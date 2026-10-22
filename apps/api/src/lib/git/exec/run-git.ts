import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { timed } from '../../timing.js';
import { GitCommandFailedError } from './exec.errors.js';

export interface RunGitOptions {
  args: string[];
  gitDir: string;
  input?: Buffer | Readable;
  /** Merged over the inherited environment, after `GIT_DIR`. */
  env?: Record<string, string>;
}

export async function runGit(options: RunGitOptions): Promise<string> {
  return (await runGitBuffer(options)).toString('utf8');
}

function spawnGit({ args, gitDir, env }: RunGitOptions) {
  return spawn('git', args, {
    env: { ...process.env, GIT_DIR: gitDir, ...env },
  });
}

function feed(
  child: ReturnType<typeof spawnGit>,
  input: RunGitOptions['input'],
) {
  if (input === undefined) child.stdin.end();
  else if (Buffer.isBuffer(input)) child.stdin.end(input);
  else input.pipe(child.stdin);
}

export function runGitBuffer(options: RunGitOptions): Promise<Buffer> {
  return timed(`git ${options.args.slice(0, 2).join(' ')}`, () =>
    bufferGit(options),
  );
}

function bufferGit({
  args,
  gitDir,
  input,
  env,
}: RunGitOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawnGit({ args, gitDir, env });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', reject);
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (!isUnreadInput(error)) reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout));
      reject(
        new GitCommandFailedError(
          args[0],
          code,
          Buffer.concat(stderr).toString('utf8').trim(),
          Buffer.concat(stdout).toString('utf8'),
        ),
      );
    });

    feed(child, input);
  });
}

/** git's stdout as a stream, for output too large to hold in memory. It ends only once git exits cleanly, and a failing git errors it instead, so output cut short is never mistaken for a whole file. A consumer that stops reading kills git. */
export function runGitReadable({ args, gitDir, env }: RunGitOptions): Readable {
  const child = spawnGit({ args, gitDir, env });
  child.stdin.end();

  const output = new PassThrough();
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  // stdout can reach its end before git's exit status is known, so the end is held back until `close`.
  child.stdout.pipe(output, { end: false });
  child.on('error', (error) => output.destroy(error));
  child.on('close', (code) => {
    if (output.destroyed) return;
    if (code === 0) return void output.end();
    output.destroy(
      new GitCommandFailedError(
        args[0],
        code,
        Buffer.concat(stderr).toString('utf8').trim(),
      ),
    );
  });
  output.on('close', () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });

  return output;
}

/** {@link runGit} that yields stdout as git produces it. A consumer that stops iterating kills git, so the exit status is only checked once the stream drains. */
export async function* runGitStream({
  args,
  gitDir,
  input,
  env,
}: RunGitOptions): AsyncGenerator<string> {
  const child = spawnGit({ args, gitDir, env });

  const stderr: Buffer[] = [];
  const failures: Error[] = [];
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (!isUnreadInput(error)) failures.push(error);
  });

  feed(child, input);

  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.on('error', (error) => failures.push(error));

  // A chunk boundary can land mid-codepoint, so decode across chunks.
  const decoder = new StringDecoder('utf8');
  let drained = false;

  try {
    for await (const chunk of child.stdout) {
      const text = decoder.write(chunk as Buffer);
      if (text) yield text;
    }
    const tail = decoder.end();
    if (tail) yield tail;
    drained = true;
  } finally {
    if (!drained) child.kill('SIGTERM');
  }

  const [code] = (await once(child, 'close')) as [number | null];
  if (failures.length > 0) throw failures[0];
  if (code !== 0) {
    throw new GitCommandFailedError(
      args[0],
      code,
      Buffer.concat(stderr).toString('utf8').trim(),
    );
  }
}

/** git exited before reading all it was given, as when a caller stops early; its exit status says what happened, so the failed write is not an error of its own. */
function isUnreadInput(error: NodeJS.ErrnoException) {
  return error.code === 'EPIPE';
}
