import { runGit } from '../exec/run-git.js';

/** Whether git accepts `name` as a branch or tag. Leading dashes and `HEAD` are refused too, so a name can never reach git as a flag or shadow the symbolic ref. */
export async function isValidRefName(
  namespace: 'heads' | 'tags',
  name: string,
) {
  if (name.startsWith('-') || name === 'HEAD') return false;
  return runGit({
    args: ['check-ref-format', `refs/${namespace}/${name}`],
    gitDir: '.',
  }).then(
    () => true,
    () => false,
  );
}
