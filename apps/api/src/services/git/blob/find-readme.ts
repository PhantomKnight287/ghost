import { listTree } from '../tree/list-tree.js';

const CANDIDATES = [
  'readme.md',
  'readme.markdown',
  'readme.mdown',
  'readme.rst',
  'readme.txt',
  'readme',
];

export async function findReadmePath({
  gitDir,
  ref,
  prefix = '',
}: {
  gitDir: string;
  ref: string;
  /** Trailing-slash directory prefix, as `normalizeTreePath` produces. */
  prefix?: string;
}): Promise<string | null> {
  const entries = await listTree({ gitDir, ref, prefix }).catch(() => []);

  const byName = new Map(
    entries
      .filter((entry) => entry.type === 'blob')
      .map((entry) => [entry.name.toLowerCase(), entry.path]),
  );

  for (const candidate of CANDIDATES) {
    const path = byName.get(candidate);
    if (path) return path;
  }

  return null;
}
