import { runGit } from '../exec/run-git.js';

export async function listRefs(gitDir: string) {
  const raw = await runGit({
    args: ['for-each-ref', '--format=%(refname) %(objectname)'],
    gitDir,
  });
  return new Map(
    raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, oid] = line.split(' ');
        return [ref, oid] as const;
      }),
  );
}

/** Branch names, without `refs/heads/`. */
export async function listBranches(gitDir: string) {
  const raw = await runGit({
    // `short` would print `heads/v1` for a branch that shares its name with a tag
    args: ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/'],
    gitDir,
  });
  return raw.split('\n').filter(Boolean);
}
