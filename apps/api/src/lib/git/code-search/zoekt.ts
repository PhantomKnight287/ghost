import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

import { runGit } from '../exec/run-git.js';
import {
  CodeSearchUnavailableError,
  InvalidSearchQueryError,
} from './code-search.errors.js';

const execFileAsync = promisify(execFile);

// Every constant below bounds what one request can cost, whatever the query: zoekt stops early, and nothing here grows with the size of the index or of a file.
const SEARCH_TIMEOUT_MS = 10_000;
const MAX_WALL_TIME_NS = 3_000_000_000;
const TOTAL_MAX_MATCHES = 10_000;
// zoekt has no offset and its order shifts between calls, so every page is cut from one name list of this fixed size, sorted here.
const LISTED_FILES = 1_000;
// A thousand names with paths up to git's 4 KiB each.
const LIST_RESPONSE_BYTES = 8 * 1024 * 1024;
// The indexer skips larger files, so a file's matching lines can never add up to more than this.
const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
// Base64 grows a file's lines by a third; the rest is room for the JSON around them.
const FILE_RESPONSE_BYTES = 2 * FILE_LIMIT_BYTES;
// Also the match cap on each file's query, so zoekt itself sends at most this many lines and fragments.
const LINES_PER_FILE = 10;
// Cut before decoding, so a megabyte line costs no more than a short one. Four bytes per character at most, so the cut keeps every character shown.
const MAX_LINE_BYTES = 2_000;
const MAX_LINE_LENGTH = 500;
const RANGES_PER_LINE = 20;

export interface CodeSearchFile {
  repositoryId: string;
  path: string;
  /** The commit the shard was built from, which is what the line numbers refer to. */
  commit: string;
  language: string;
}

export interface CodeSearchHit extends CodeSearchFile {
  /** Matches in the file, as far as zoekt counted before its limits; `lines` holds the first few. */
  matchCount: number;
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
  Score: number;
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
    '-file_limit',
    String(FILE_LIMIT_BYTES),
    '-disable_ctags',
    repoDirectory,
  ]);
  return (await readdir(indexDir)).filter((name) => name.endsWith('.zoekt'));
}

/** Every file that matches, best first, without reading its lines. Ties sort by repository and path, so the same index always gives the same order. */
// ponytail: a query that hits zoekt's match limits, like `.*`, can list a slightly different set from one call to the next; a cached list per query would pin it.
export async function listMatchingFiles({
  url,
  query,
}: {
  url: string;
  query: string;
}): Promise<CodeSearchFile[]> {
  const { files } = await search(
    url,
    `type:filename (${query})`,
    { MaxDocDisplayCount: LISTED_FILES },
    LIST_RESPONSE_BYTES,
  );
  return files
    .sort(
      (a, b) =>
        b.Score - a.Score ||
        a.Repository.localeCompare(b.Repository) ||
        a.FileName.localeCompare(b.FileName),
    )
    .map((file) => ({
      repositoryId: file.Repository,
      path: file.FileName,
      commit: file.Version,
      language: file.Language,
    }));
}

/** Exactly these files, in their order, with their first matching lines; a file that matched by its path alone has none. One query per file, so zoekt caps every file's matches on its own and a page of minified bundles stays within a few megabytes per file. */
export async function searchFiles({
  url,
  query,
  files,
}: {
  url: string;
  query: string;
  files: CodeSearchFile[];
}): Promise<CodeSearchHit[]> {
  return Promise.all(
    files.map(async (file) => {
      const found = await search(
        url,
        `(${query}) r:^${literalRegExp(file.repositoryId)}$ f:^${literalRegExp(file.path)}$`,
        { MaxDocDisplayCount: 1, MaxMatchDisplayCount: LINES_PER_FILE },
        FILE_RESPONSE_BYTES,
      );
      // the scope narrows the scan; this match on the exact file is what keeps an OR in the query from answering for another
      const matches = (
        found.files.find(
          (candidate) =>
            candidate.Repository === file.repositoryId &&
            candidate.FileName === file.path,
        )?.LineMatches ?? []
      )
        .filter((match) => !match.FileName)
        .sort((a, b) => a.LineNumber - b.LineNumber);

      return {
        ...file,
        matchCount: matches.length ? found.matchCount : 0,
        lines: matches.map((match) => {
          const line = Buffer.from(
            match.Line.slice(0, Math.ceil(MAX_LINE_BYTES / 3) * 4),
            'base64',
          ).subarray(0, MAX_LINE_BYTES);
          return {
            lineNumber: match.LineNumber,
            line: line
              .toString('utf8')
              .replace(/\r?\n$/, '')
              .slice(0, MAX_LINE_LENGTH),
            ranges: match.LineFragments.slice(0, RANGES_PER_LINE).flatMap(
              (fragment) => {
                const start = charOffset(line, fragment.LineOffset);
                if (start >= MAX_LINE_LENGTH) return [];
                const end = charOffset(
                  line,
                  fragment.LineOffset + fragment.MatchLength,
                );
                return [{ start, end: Math.min(end, MAX_LINE_LENGTH) }];
              },
            ),
          };
        }),
      };
    }),
  );
}

async function search(
  url: string,
  query: string,
  options: { MaxDocDisplayCount: number; MaxMatchDisplayCount?: number },
  maxResponseBytes: number,
): Promise<{ files: ZoektFile[]; matchCount: number }> {
  const response = await fetch(new URL('/api/search', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Q: query,
      Opts: {
        ...options,
        TotalMaxMatchCount: TOTAL_MAX_MATCHES,
        MaxWallTime: MAX_WALL_TIME_NS,
      },
    }),
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

  const { Result } = JSON.parse(
    await readAtMost(response, maxResponseBytes),
  ) as { Result: { Files: ZoektFile[] | null; MatchCount: number } };
  return { files: Result.Files ?? [], matchCount: Result.MatchCount };
}

/** The budgets are sized so an index built here never reaches them; one that does was built with other limits, and is refused rather than read into memory. */
async function readAtMost(response: Response, limit: number) {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new CodeSearchUnavailableError({
        cause: new Error(`zoekt answered more than ${limit} bytes`),
      });
    }
    chunks.push(read.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// zoekt reports byte offsets; a browser slices UTF-16 strings.
function charOffset(line: Buffer, byteOffset: number) {
  return line.subarray(0, byteOffset).toString('utf8').length;
}

/** A zoekt `r:` clause matching exactly these repositories, or nothing to add when unscoped. */
export function repositoryScope(repositoryIds: string[] | undefined) {
  return repositoryIds
    ? ` r:^(${repositoryIds.map(literalRegExp).join('|')})$`
    : '';
}

// Every character outside a safe set becomes `\x{..}`: a space, quote or parenthesis would otherwise end the zoekt field it sits in.
function literalRegExp(value: string) {
  return [...value]
    .map((char) =>
      /[A-Za-z0-9_/-]/.test(char)
        ? char
        : `\\x{${char.codePointAt(0)!.toString(16)}}`,
    )
    .join('');
}
