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

// ponytail: zoekt has no offset, so every page ranks and ships every file before it; this caps that cost. A deeper reach needs zoekt's gRPC stream.
export const MAX_SEARCH_FILES = 2000;

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
    LineFragments: ZoektFragment[];
  }[];
}

interface ZoektFragment {
  LineOffset: number;
  MatchLength: number;
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

/** Matching lines only, in file order: a file that matched by its path alone comes back with none. Results stop at `MAX_SEARCH_FILES`. */
export async function searchIndex({
  url,
  query,
  offset,
  limit,
}: {
  url: string;
  query: string;
  offset: number;
  limit: number;
}): Promise<{ files: CodeSearchHit[]; hasMore: boolean }> {
  const end = Math.min(offset + limit, MAX_SEARCH_FILES);
  const response = await fetch(new URL('/api/search', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // One file past the page tells whether another page exists.
    body: JSON.stringify({ Q: query, Opts: { MaxDocDisplayCount: end + 1 } }),
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
  const files = Result.Files ?? [];

  return {
    hasMore: files.length > end && end < MAX_SEARCH_FILES,
    files: files.slice(offset, end).map((file) => ({
      repositoryId: file.Repository,
      commit: file.Version,
      path: file.FileName,
      language: file.Language,
      // zoekt orders a file's lines by score.
      lines: (file.LineMatches ?? [])
        .filter((match) => !match.FileName)
        .sort((a, b) => a.LineNumber - b.LineNumber)
        .map((match) => {
          const line = Buffer.from(match.Line, 'base64');
          return {
            lineNumber: match.LineNumber,
            line: line.toString('utf8').replace(/\r?\n$/, ''),
            ranges: charRanges(line, match.LineFragments),
          };
        }),
    })),
  };
}

// zoekt reports byte offsets; a browser slices UTF-16 strings. Fragments never overlap, so walking them in order decodes each byte once however many matches a minified line holds.
function charRanges(line: Buffer, fragments: ZoektFragment[]) {
  let byte = 0;
  let char = 0;
  const charAt = (target: number) => {
    char += line.subarray(byte, target).toString('utf8').length;
    byte = target;
    return char;
  };

  return [...fragments]
    .sort((a, b) => a.LineOffset - b.LineOffset)
    .map((fragment) => ({
      start: charAt(fragment.LineOffset),
      end: charAt(fragment.LineOffset + fragment.MatchLength),
    }));
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
