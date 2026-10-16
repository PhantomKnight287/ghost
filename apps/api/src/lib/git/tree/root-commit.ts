import type { CommitSigner } from '../commits/commit-signature.js';
import { runGit } from '../exec/run-git.js';
import { commitTree } from '../merge/merge.js';

/** A parentless commit holding `files` at the top level, each a regular file; only new objects are written to `gitDir`. */
export async function rootCommit({
  gitDir,
  files,
  message,
  author,
  sign,
}: {
  gitDir: string;
  files: Record<string, string>;
  message: string;
  author: { name: string; email: string };
  sign?: CommitSigner;
}): Promise<string> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const blob = await runGit({
        args: ['hash-object', '-w', '--stdin'],
        gitDir,
        input: Buffer.from(content),
      });
      return `100644 blob ${blob.trim()}\t${name}\n`;
    }),
  );
  const tree = await runGit({
    args: ['mktree'],
    gitDir,
    input: Buffer.from(entries.join('')),
  });
  return commitTree({
    gitDir,
    tree: tree.trim(),
    parents: [],
    message,
    author,
    sign,
  });
}
