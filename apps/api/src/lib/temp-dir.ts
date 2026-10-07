import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Runs `work` in a fresh scratch directory named after `prefix`, removed afterwards whatever happens. */
export async function withTempDir<T>(
  prefix: string,
  work: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
