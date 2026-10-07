import path from 'node:path';

import { LINGUIST_ATTRIBUTES, type LinguistAttributes } from '@ghost/languages';

import { withTempDir } from '../../temp-dir.js';
import { runGit } from '../exec/run-git.js';

/** Symlinks and submodules are not files of the repository, so they hold no bytes. */
export const SKIPPED_MODES = new Set(['120000', '160000']);

interface Side {
  path: string;
  oid: string;
}

export interface RawChange {
  before?: Side;
  after?: Side;
}

/**
 * `git diff --raw -r -z` as sides to subtract and add.
 *
 * Each entry is ":<srcmode> <dstmode> <srcoid> <dstoid> <status>" followed by one path, or two for a rename or copy. Symlinks and submodules are dropped per side, so a file becoming a symlink still subtracts its old bytes.
 */
export async function readRawDiff(
  gitDir: string,
  from: string,
  to: string,
): Promise<RawChange[]> {
  const raw = await runGit({
    args: [
      'diff',
      '--raw',
      '-r',
      '-z',
      '--no-abbrev', // --no-abbrev keeps the oids full, which is what cat-file echoes back
      '--end-of-options',
      from,
      to,
    ],
    gitDir,
  });

  const fields = raw.split('\0');
  const changes: RawChange[] = [];

  for (let i = 0; i < fields.length; i++) {
    if (!fields[i].startsWith(':')) continue;

    const [srcMode, dstMode, srcOid, dstOid, status] = fields[i]
      .slice(1)
      .split(' ');
    // a rename or a copy names the destination in a second path field
    const renamed = status?.startsWith('R') || status?.startsWith('C');
    const srcPath = fields[++i];
    const dstPath = renamed ? fields[++i] : srcPath;
    if (srcPath === undefined || dstPath === undefined) break;

    changes.push({
      before: isCounted(srcMode, srcOid)
        ? { path: srcPath, oid: srcOid }
        : undefined,
      after: isCounted(dstMode, dstOid)
        ? { path: dstPath, oid: dstOid }
        : undefined,
    });
  }

  return changes;
}

function isCounted(mode: string, oid: string) {
  return !SKIPPED_MODES.has(mode) && !/^0+$/.test(oid);
}

export function isGitAttributes(file: string) {
  return file === '.gitattributes' || file.endsWith('/.gitattributes');
}

/**
 * Each path's linguist attributes as the `.gitattributes` files in `tree` assign them; paths with none are left out.
 *
 * Read through a throwaway index, which works in a bare repository and on git older than 2.40's `check-attr --source`.
 */
export async function readAttributes(
  gitDir: string,
  tree: string,
  files: string[],
): Promise<Map<string, LinguistAttributes>> {
  const attributes = new Map<string, LinguistAttributes>();
  if (files.length === 0) return attributes;

  await withTempDir('ghost-attributes-', async (directory) => {
    const env = { GIT_INDEX_FILE: path.join(directory, 'index') };
    await runGit({ args: ['read-tree', tree], gitDir, env });
    const output = await runGit({
      args: ['check-attr', '--cached', '-z', '--stdin', ...LINGUIST_ATTRIBUTES],
      gitDir,
      env,
      input: Buffer.from(files.map((file) => `${file}\0`).join('')),
    });

    // "<path>\0<attribute>\0<value>\0" for every path and attribute asked for
    const fields = output.split('\0');
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const [file, name, value] = fields.slice(i, i + 3);
      if (value === 'unspecified') continue;
      attributes.set(file, {
        ...attributes.get(file),
        [name]: value,
      });
    }
  });

  return attributes;
}
