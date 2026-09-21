import { runGit } from '../exec/run-git.js';

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  oid: string;
  /** Blob size in bytes; null for trees and submodules. */
  size: number | null;
  /** Entry name within the listed directory. */
  name: string;
  /** Full repository-relative path. */
  path: string;
}

/**
 * One level of a tree, in one git process. Non-recursive on purpose: a listing wants a row per child, not per descendant.
 *
 * `prefix` is the trailing-slash form produced by `normalizeTreePath`, which is the only thing that should ever reach this.
 */
export async function listTree({
  gitDir,
  ref,
  prefix,
}: {
  gitDir: string;
  ref: string;
  prefix: string;
}): Promise<TreeEntry[]> {
  const raw = await runGit({
    args: [
      'ls-tree',
      '-z',
      '-l',
      // a ref is data too, and one starting with "-" would parse as an option
      '--end-of-options',
      ref,
      '--',
      // git reads a leading ":" as pathspec magic, and ":/" alone means "from the root" - :(literal) keeps the prefix an exact, unglobbed path. "." is git's spelling of the root; an empty pathspec is rejected.
      prefix ? `:(literal)${prefix}` : '.',
    ],
    gitDir,
  });

  const entries = raw
    .split('\0')
    .filter(Boolean)
    .flatMap((record) => {
      // "<mode> <type> <oid> <size>\t<path>", size padded, "-" for trees
      const tab = record.indexOf('\t');
      if (tab === -1) return [];

      const [mode, type, oid, size] = record.slice(0, tab).trim().split(/\s+/);
      const path = record.slice(tab + 1);

      return [
        {
          mode,
          type: type as TreeEntry['type'],
          oid,
          size: size === '-' ? null : Number(size),
          name: path.slice(prefix.length),
          path,
        },
      ];
    });

  return orderTreeEntries(entries);
}

/** Pinned locale so ordering is identical wherever the API runs. `numeric` puts `file2.ts` ahead of `file10.ts`, and the default sensitivity keeps `readme.md` next to `README.md`. */
const COLLATOR = new Intl.Collator('en', { numeric: true });

const byName = (a: TreeEntry, b: TreeEntry) => COLLATOR.compare(a.name, b.name);

/** Directories first, then files, each alphabetical. Submodules sort as directories. */
export function orderTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  const directories: TreeEntry[] = [];
  const files: TreeEntry[] = [];

  for (const entry of entries) {
    (entry.type === 'blob' ? files : directories).push(entry);
  }

  directories.sort(byName);
  files.sort(byName);

  return [...directories, ...files];
}
