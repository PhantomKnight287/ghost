import { GitCommandFailedError } from '../exec/exec.errors.js';
import { runGit } from '../exec/run-git.js';
import { type RefTransition, ZERO_OID } from '../wal/wal.types.js';
import type { RefFacts } from '../../rulesets/rulesets.types.js';

/** What rulesets need to know about each move: whether it keeps the old tip, and whether it reaches a merge commit no existing ref reaches. `env` points git at a push's quarantine. Deletions have no facts. */
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
        args: ['rev-list', '--min-parents=2', '-n1', next, '--not', '--all'],
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
