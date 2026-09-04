import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

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
