import { spawn } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';

import {
  type GitServiceName,
  protocolEnv,
  toGitBinary,
} from './git-service.js';

/** Runs upload-pack or receive-pack in `--stateless-rpc` mode and hands back its stdout, warning with whatever it writes to stderr. */
export function spawnPack({
  service,
  repoDirectory,
  protocol,
  flags = [],
  input,
  warn,
}: {
  service: GitServiceName;
  repoDirectory: string;
  protocol?: string;
  flags?: string[];
  input?: Readable;
  warn: (message: string) => void;
}): Readable {
  const binary = toGitBinary(service);
  const output = new PassThrough();
  const child = spawn(
    'git',
    [binary, '--stateless-rpc', ...flags, repoDirectory],
    { env: { ...process.env, ...protocolEnv(protocol) } },
  );

  if (input) input.pipe(child.stdin);
  else child.stdin.end();
  child.stdout.pipe(output);
  child.stderr.on('data', (chunk: Buffer) =>
    warn(`${binary} stderr: ${chunk.toString()}`),
  );
  child.on('error', (error) => output.destroy(error));

  return output;
}
