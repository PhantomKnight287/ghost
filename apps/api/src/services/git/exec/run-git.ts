import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { GitCommandFailedError } from './exec.errors.js';

export interface RunGitOptions {
  args: string[];
  gitDir: string;
  input?: Buffer | Readable;
}

export async function runGit({
  args,
  gitDir,
  input,
}: RunGitOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      env: { ...process.env, GIT_DIR: gitDir },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      reject(
        new GitCommandFailedError(
          args[0],
          code,
          Buffer.concat(stderr).toString('utf8').trim(),
        ),
      );
    });

    if (input === undefined) child.stdin.end();
    else if (Buffer.isBuffer(input)) child.stdin.end(input);
    else input.pipe(child.stdin);
  });
}

/**
 * Same as {@link runGit}, but hands stdout back in chunks as git produces it.
 *
 * History walks can outrun what the caller needs — a listing is answered once
 * every entry has a commit — so a consumer that stops iterating kills git
 * rather than paying for output nobody will read. The exit status is only
 * checked when the stream is drained: a deliberate early exit leaves git dying
 * on a closed pipe, which is not a failure.
 */
export async function* runGitStream({
  args,
  gitDir,
  input,
}: RunGitOptions): AsyncGenerator<string> {
  const child = spawn('git', args, {
    env: { ...process.env, GIT_DIR: gitDir },
  });

  if (input === undefined) child.stdin.end();
  else if (Buffer.isBuffer(input)) child.stdin.end(input);
  else input.pipe(child.stdin);

  const stderr: Buffer[] = [];
  const failures: Error[] = [];
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
