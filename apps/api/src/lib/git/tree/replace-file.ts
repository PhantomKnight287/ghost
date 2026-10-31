import path from 'node:path';

import type { CommitSigner } from '../commits/commit-signature.js';
import { runGit } from '../exec/run-git.js';
import { commitTree } from '../merge/merge.js';
import { withTempDir } from '../../temp-dir.js';

/** A commit on top of `parent` that changes one existing file's content and keeps its mode. Built with a throwaway index, so nothing in `gitDir` but new objects changes. */
export async function replaceFile({
  gitDir,
  parent,
  file,
  content,
  message,
  author,
  sign,
}: {
  gitDir: string;
  parent: string;
  file: string;
  content: Buffer;
  message: string;
  author: { name: string; email: string };
  sign?: CommitSigner;
}): Promise<string> {
  const listed = await runGit({
    args: ['ls-tree', '--full-tree', parent, '--', file],
    gitDir,
  });
  const mode = listed.split(' ')[0];
  const blob = (
    await runGit({
      args: ['hash-object', '-w', '--stdin'],
      gitDir,
      input: content,
    })
  ).trim();

  return await withTempDir('ghost-index-', async (directory) => {
    const env = { GIT_INDEX_FILE: path.join(directory, 'index') };
    await runGit({ args: ['read-tree', parent], gitDir, env });
    await runGit({
      args: ['update-index', '--cacheinfo', `${mode},${blob},${file}`],
      gitDir,
      env,
    });
    const tree = (await runGit({ args: ['write-tree'], gitDir, env })).trim();
    return await commitTree({
      gitDir,
      tree,
      parents: [parent],
      message,
      author,
      sign,
    });
  });
}
