import { runGit } from './run-git.js';

/** The type of each object, in order: `commit`, `tree`, `blob`, `tag`, or `missing` for an object the repository does not hold. */
export async function objectTypes({
  gitDir,
  oids,
  env,
}: {
  gitDir: string;
  oids: string[];
  env?: Record<string, string>;
}) {
  const output = await runGit({
    args: ['cat-file', '--batch-check=%(objecttype)'],
    gitDir,
    env,
    input: Buffer.from(`${oids.join('\n')}\n`),
  });
  // a missing object is echoed back as "<oid> missing"
  return output
    .trim()
    .split('\n')
    .map((line) => line.split(' ').at(-1) ?? '');
}
