import { runGit } from '../exec/run-git.js';
import { type RefTransition, ZERO_OID } from '../wal/wal.types.js';

/** Commits `newOid` reaches that the write adds, newest first: beyond the old tip for an update, beyond every ref outside refs/pull/* for a create, as `refFacts` judges a create. `env` points git at a push's quarantine. */
export async function addedCommits({
  gitDir,
  env,
  transition: { oldOid, newOid },
}: {
  gitDir: string;
  env?: Record<string, string>;
  transition: RefTransition;
}): Promise<{ sha: string; authorEmail: string }[]> {
  const stdout = await runGit({
    args: [
      'log',
      '--format=%H%x00%ae',
      newOid.toString('hex'),
      '--not',
      ...(oldOid.equals(ZERO_OID)
        ? ['--exclude=refs/pull/*', '--all']
        : [oldOid.toString('hex')]),
    ],
    gitDir,
    env,
  });
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, authorEmail] = line.split('\0');
      return { sha, authorEmail };
    });
}

/** `oid` peeled to the commit it names, so an annotated tag is judged by its commit. */
export async function peeledCommit({
  gitDir,
  env,
  oid,
}: {
  gitDir: string;
  env?: Record<string, string>;
  oid: string;
}) {
  return (
    await runGit({ args: ['rev-parse', `${oid}^{commit}`], gitDir, env })
  ).trim();
}
