import type { RefFacts } from '../../rulesets/rulesets.types.js';
import { GitCommandFailedError } from '../exec/exec.errors.js';
import { runGit } from '../exec/run-git.js';
import { type RefTransition, ZERO_OID } from '../wal/wal.types.js';

/** What rulesets need to know about each move: whether it keeps the old tip, and whether it brings in a merge commit. `env` points git at a push's quarantine. Deletions have no facts. */
export async function refFacts({
  gitDir,
  env,
  transitions,
}: {
  gitDir: string;
  env?: Record<string, string>;
  transitions: RefTransition[];
}) {
  const facts = new Map<string, RefFacts>();
  for (const { ref, oldOid, newOid } of transitions) {
    if (newOid.equals(ZERO_OID)) continue;
    const next = newOid.toString('hex');
    const [isFastForward, merge] = await Promise.all([
      oldOid.equals(ZERO_OID)
        ? true
        : runGit({
            args: ['merge-base', '--is-ancestor', oldOid.toString('hex'), next],
            gitDir,
            env,
          }).then(
            () => true,
            (error: unknown) => {
              // Exit 1 is git's "no"; anything else is a real failure.
              if (
                error instanceof GitCommandFailedError &&
                error.exitCode === 1
              )
                return false;
              throw error;
            },
          ),
      runGit({
        // An update is judged against its own old tip, so a merge commit another branch already reaches cannot be fast-forwarded in. A new ref is judged against everything the repository already holds, minus test merges: otherwise branching off any history with a merge in it would be refused.
        args: oldOid.equals(ZERO_OID)
          ? [
              'rev-list',
              '--min-parents=2',
              '-n1',
              next,
              '--not',
              '--exclude=refs/pull/*',
              '--all',
            ]
          : [
              'rev-list',
              '--min-parents=2',
              '-n1',
              next,
              '--not',
              oldOid.toString('hex'),
            ],
        gitDir,
        env,
      }),
    ]);
    facts.set(ref, {
      isFastForward,
      introducesMergeCommit: merge.trim() !== '',
    });
  }
  return facts;
}
