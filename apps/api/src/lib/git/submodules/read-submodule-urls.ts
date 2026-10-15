import { GitCommandFailedError } from '../exec/exec.errors.js';
import { runGit } from '../exec/run-git.js';

/** Each submodule's URL by its path, as `.gitmodules` at `ref` declares them. */
export async function readSubmoduleUrls({
  gitDir,
  ref,
}: {
  gitDir: string;
  ref: string;
}): Promise<Map<string, string>> {
  const raw = await runGit({
    args: [
      'config',
      `--blob=${ref}:.gitmodules`,
      '-z',
      '--get-regexp',
      String.raw`^submodule\..*\.(path|url)$`,
    ],
    gitDir,
  }).catch((error: unknown) => {
    // a ref without .gitmodules, or with one git cannot parse, leaves its gitlinks without a URL rather than failing the listing
    if (error instanceof GitCommandFailedError) return '';
    throw error;
  });

  const byName = new Map<string, { path?: string; url?: string }>();
  for (const record of raw.split('\0')) {
    // "submodule.<name>.<path|url>\n<value>"; a key written without a value has no newline
    const newline = record.indexOf('\n');
    if (newline === -1) continue;

    const key = record.slice(0, newline);
    const field = key.endsWith('.path') ? 'path' : 'url';
    const name = key.slice('submodule.'.length, -`.${field}`.length);
    byName.set(name, {
      ...byName.get(name),
      [field]: record.slice(newline + 1),
    });
  }

  return new Map(
    [...byName.values()].flatMap(({ path, url }) =>
      path && url ? [[path, url] as const] : [],
    ),
  );
}
