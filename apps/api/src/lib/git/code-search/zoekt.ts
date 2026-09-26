import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

import { runGit } from '../exec/run-git.js';
import {
  CodeSearchUnavailableError,
  InvalidSearchQueryError,
} from './code-search.errors.js';

const execFileAsync = promisify(execFile);

const SEARCH_TIMEOUT_MS = 10_000;

export interface CodeSearchHit {
  repositoryId: string;
  /** The commit the shard was built from, which is what the line numbers refer to. */
  commit: string;
  path: string;
  language: string;
  lines: {
    lineNumber: number;
    line: string;
    /** Half-open [start, end) offsets that slice `line` as a JavaScript string. */
    ranges: { start: number; end: number }[];
  }[];
}

/** The fields of zoekt's `FileMatch` read here. `[]byte` fields arrive base64 encoded. */
interface ZoektFile {
  FileName: string;
  Repository: string;
  Version: string;
  Language: string;
  LineMatches?: {
    Line: string;
    LineNumber: number;
    FileName: boolean;
    LineFragments: { LineOffset: number; MatchLength: number }[];
  }[];
}

/** Shards are named `<name>_v16.00000.zoekt`, with further numbered shards for a large repository. Returns their file names. */
export async function indexRepository({
  indexDir,
  repoDirectory,
  name,
  isPublic,
}: {
  indexDir: string;
  repoDirectory: string;
  name: string;
  isPublic: boolean;
}) {
  // zoekt copies the `zoekt` config section into the shard, which is what `public:yes` matches, but only for a repository that has `zoekt.name` or an origin remote; the API's cache has no origin.
  for (const [key, value] of [
    ['zoekt.name', name],
    ['zoekt.public', isPublic ? '1' : '0'],
  ]) {
    await runGit({ args: ['config', key, value], gitDir: repoDirectory });
  }
  await execFileAsync('zoekt-git-index', [
    '-index',
    indexDir,
    '-branches',
    'HEAD',
    '-submodules=false',
    '-disable_ctags',
    repoDirectory,
  ]);
  return (await readdir(indexDir)).filter((name) => name.endsWith('.zoekt'));
}

/** Matching lines only: a file that matched by its path alone comes back with none. */
export async function searchIndex({
  url,
  query,
  limit,
}: {
  url: string;
  query: string;
  limit: number;
}): Promise<CodeSearchHit[]> {
  const response = await fetch(new URL('/api/search', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Q: query, Opts: { MaxDocDisplayCount: limit } }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  }).catch((cause: unknown) => {
    throw new CodeSearchUnavailableError({ cause });
  });

  if (response.status === 400) {
    const { Error: reason } = (await response.json()) as { Error: string };
    throw new InvalidSearchQueryError(reason);
  }
  if (!response.ok) {
    throw new CodeSearchUnavailableError({
      cause: new Error(
        `zoekt answered ${response.status}: ${await response.text()}`,
      ),
    });
  }

  const { Result } = (await response.json()) as {
    Result: { Files: ZoektFile[] | null };
  };

  return (Result.Files ?? []).map((file) => ({
    repositoryId: file.Repository,
    commit: file.Version,
    path: file.FileName,
    language: file.Language,
    lines: (file.LineMatches ?? [])
      .filter((match) => !match.FileName)
      .map((match) => {
        const line = Buffer.from(match.Line, 'base64');
        return {
          lineNumber: match.LineNumber,
          line: line.toString('utf8').replace(/\r?\n$/, ''),
          ranges: match.LineFragments.map((fragment) => ({
            start: charOffset(line, fragment.LineOffset),
            end: charOffset(line, fragment.LineOffset + fragment.MatchLength),
          })),
        };
      }),
  }));
}

// zoekt reports byte offsets; a browser slices UTF-16 strings.
function charOffset(line: Buffer, byteOffset: number) {
  return line.subarray(0, byteOffset).toString('utf8').length;
}

/** A zoekt `r:` clause matching exactly these repositories, or nothing to add when unscoped. */
export function repositoryScope(repositoryIds: string[] | undefined) {
  return repositoryIds
    ? ` r:^(${repositoryIds.map(escapeRegExp).join('|')})$`
    : '';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
