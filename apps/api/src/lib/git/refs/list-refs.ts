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

export interface RefEntry {
  /** Without the `refs/heads/` or `refs/tags/` prefix. */
  name: string;
  oid: string;
  type: string;
  /** The object an annotated tag points at; null for anything else. */
  peeledOid: string | null;
  peeledType: string | null;
  /** Committer time, in seconds, of the commit the ref points at through any annotation; 0 for a tag of something else. */
  commitDate: number;
}

const ENTRY_FIELDS = [
  '%(refname:strip=2)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(*objecttype)',
  '%(committerdate:unix)',
  '%(*committerdate:unix)',
];

/** Every branch or every tag, by name. */
export async function listRefEntries(
  gitDir: string,
  prefix: 'refs/heads/' | 'refs/tags/',
): Promise<RefEntry[]> {
  const raw = await runGit({
    args: ['for-each-ref', `--format=${ENTRY_FIELDS.join('%00')}`, prefix],
    gitDir,
  });
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, type, oid, peeled, peeledType, date, peeledDate] =
        line.split('\0');
      return {
        name,
        oid,
        type,
        peeledOid: peeled || null,
        peeledType: peeledType || null,
        commitDate: Number(date || peeledDate) || 0,
      };
    });
}
