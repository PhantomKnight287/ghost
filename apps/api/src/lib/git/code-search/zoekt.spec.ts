import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  CodeSearchUnavailableError,
  InvalidSearchQueryError,
} from './code-search.errors.js';
import { indexRepository, listMatchingFiles, searchFiles } from './zoekt.js';

const hasZoekt = (() => {
  try {
    execFileSync('zoekt-webserver', ['-version']);
    execFileSync('zoekt-git-index', ['-version']);
    return true;
  } catch {
    return false;
  }
})();

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const URL = 'http://zoekt:6070';

const replyWith = (body: unknown, status = 200) => {
  const fetch = vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const sentQuery = (fetch: ReturnType<typeof replyWith>, call = 0) =>
  JSON.parse(
    (fetch.mock.calls[call] as unknown as [URL, RequestInit])[1].body as string,
  ) as { Q: string; Opts: Record<string, number> };

const zoektFile = (
  repository: string,
  fileName: string,
  extra: Record<string, unknown> = {},
) => ({
  FileName: fileName,
  Repository: repository,
  Version: 'c1',
  Language: 'TypeScript',
  Score: 1,
  ...extra,
});

const pageFile = (repositoryId: string, path: string) => ({
  repositoryId,
  path,
  commit: 'c1',
  language: 'TypeScript',
});

const lineMatch = (
  lineNumber: number,
  line: string,
  offset = 0,
  length = 1,
) => ({
  Line: b64(`${line}\n`),
  LineNumber: lineNumber,
  FileName: false,
  LineFragments: [{ LineOffset: offset, MatchLength: length }],
});

describe('listMatchingFiles', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for names only and sorts by score, then repository and path', async () => {
    const fetch = replyWith({
      Result: {
        Files: [
          zoektFile('repo_b', 'z.ts', { Score: 1 }),
          zoektFile('repo_a', 'y.ts', { Score: 1 }),
          zoektFile('repo_a', 'x.ts', { Score: 1 }),
          zoektFile('repo_c', 'w.ts', { Score: 9 }),
        ],
      },
    });

    await expect(listMatchingFiles({ url: URL, query: 'x' })).resolves.toEqual([
      pageFile('repo_c', 'w.ts'),
      pageFile('repo_a', 'x.ts'),
      pageFile('repo_a', 'y.ts'),
      pageFile('repo_b', 'z.ts'),
    ]);
    expect(sentQuery(fetch)).toEqual({
      Q: 'type:filename (x)',
      Opts: {
        MaxDocDisplayCount: 2000,
        TotalMaxMatchCount: 10_000,
        MaxWallTime: 3_000_000_000,
      },
    });
  });

  it('returns no files when zoekt reports none', async () => {
    replyWith({ Result: { Files: null } });

    await expect(listMatchingFiles({ url: URL, query: 'x' })).resolves.toEqual(
      [],
    );
  });

  it('rejects a query zoekt cannot parse', async () => {
    replyWith({ Error: 'unbalanced )' }, 400);

    await expect(
      listMatchingFiles({ url: URL, query: 'x' }),
    ).rejects.toBeInstanceOf(InvalidSearchQueryError);
  });

  it('is unavailable when zoekt fails', async () => {
    replyWith('oops', 500);

    await expect(
      listMatchingFiles({ url: URL, query: 'x' }),
    ).rejects.toMatchObject({
      constructor: CodeSearchUnavailableError,
      cause: new Error('zoekt answered 500: oops'),
    });
  });

  it('is unavailable when zoekt cannot be reached', async () => {
    const refused = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(refused));

    await expect(
      listMatchingFiles({ url: URL, query: 'x' }),
    ).rejects.toMatchObject({
      constructor: CodeSearchUnavailableError,
      cause: refused,
    });
  });
});

describe('searchFiles', () => {
  afterEach(() => vi.unstubAllGlobals());

  const searchOne = (path = 'a.ts') =>
    searchFiles({ url: URL, query: 'x', files: [pageFile('repo_a', path)] });

  it('asks nothing of zoekt for an empty page', async () => {
    const fetch = replyWith({ Result: { Files: null, MatchCount: 0 } });

    await expect(
      searchFiles({ url: URL, query: 'x', files: [] }),
    ).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks once per file, capping its matches and escaping every path character outside a safe set', async () => {
    const fetch = replyWith({ Result: { Files: null, MatchCount: 0 } });

    await searchFiles({
      url: URL,
      query: 'x',
      files: [pageFile('repo_a', 'src/a b(1).ts'), pageFile('repo_b', 'c.ts')],
    });

    const limits = {
      MaxDocDisplayCount: 1,
      MaxMatchDisplayCount: 10,
      TotalMaxMatchCount: 10_000,
      MaxWallTime: 3_000_000_000,
    };
    expect(sentQuery(fetch, 0)).toEqual({
      Q: String.raw`(x) r:^repo_a$ f:^src/a\x{20}b\x{28}1\x{29}\x{2e}ts$`,
      Opts: limits,
    });
    expect(sentQuery(fetch, 1)).toEqual({
      Q: String.raw`(x) r:^repo_b$ f:^c\x{2e}ts$`,
      Opts: limits,
    });
  });

  it('answers only for the exact file asked about', async () => {
    replyWith({
      Result: {
        Files: [
          zoektFile('repo_other', 'a.ts', {
            LineMatches: [lineMatch(1, 'leak')],
          }),
        ],
        MatchCount: 1,
      },
    });

    await expect(searchOne()).resolves.toEqual([
      { ...pageFile('repo_a', 'a.ts'), matchCount: 0, lines: [] },
    ]);
  });

  it('decodes lines, turns byte offsets into string offsets, and reports zoekt’s count', async () => {
    const line = 'const café = findMe();';
    replyWith({
      Result: {
        Files: [
          zoektFile('repo_a', 'a.ts', {
            LineMatches: [
              lineMatch(9, 'later'),
              {
                Line: b64('a.ts'),
                LineNumber: 0,
                FileName: true,
                LineFragments: [{ LineOffset: 0, MatchLength: 4 }],
              },
              lineMatch(3, line, Buffer.byteLength('const café = '), 6),
            ],
          }),
        ],
        MatchCount: 42,
      },
    });

    await expect(searchOne()).resolves.toEqual([
      {
        ...pageFile('repo_a', 'a.ts'),
        matchCount: 42,
        lines: [
          { lineNumber: 3, line, ranges: [{ start: 13, end: 19 }] },
          { lineNumber: 9, line: 'later', ranges: [{ start: 0, end: 1 }] },
        ],
      },
    ]);
  });

  it('refuses an answer past the byte budget rather than read it', async () => {
    replyWith({
      Result: {
        Files: [
          zoektFile('repo_a', 'a.min.js', {
            LineMatches: [lineMatch(1, 'a'.repeat(5 * 1024 * 1024))],
          }),
        ],
        MatchCount: 1,
      },
    });

    await expect(searchOne('a.min.js')).rejects.toMatchObject({
      constructor: CodeSearchUnavailableError,
      cause: new Error('zoekt answered more than 4194304 bytes'),
    });
  });

  it('keeps at most twenty ranges on a line', async () => {
    replyWith({
      Result: {
        Files: [
          zoektFile('repo_a', 'a.ts', {
            LineMatches: [
              {
                Line: b64('a'.repeat(100)),
                LineNumber: 1,
                FileName: false,
                LineFragments: Array.from({ length: 100 }, (_, i) => ({
                  LineOffset: i,
                  MatchLength: 1,
                })),
              },
            ],
          }),
        ],
        MatchCount: 100,
      },
    });

    const [hit] = await searchOne();

    expect(hit.lines[0].ranges).toHaveLength(20);
  });

  it('cuts a two-megabyte line to what is shown, with the matches inside the cut', async () => {
    replyWith({
      Result: {
        Files: [
          zoektFile('repo_a', 'a.min.js', {
            LineMatches: [
              {
                Line: b64('a'.repeat(2 * 1024 * 1024 - 1)),
                LineNumber: 1,
                FileName: false,
                LineFragments: [
                  { LineOffset: 10, MatchLength: 5 },
                  { LineOffset: 490, MatchLength: 20 },
                  { LineOffset: 600, MatchLength: 5 },
                ],
              },
            ],
          }),
        ],
        MatchCount: 3,
      },
    });

    const [hit] = await searchOne('a.min.js');

    expect(hit.lines[0].line).toHaveLength(500);
    expect(hit.lines[0].ranges).toEqual([
      { start: 10, end: 15 },
      { start: 490, end: 500 },
    ]);
  });
});

describe.skipIf(!hasZoekt)('zoekt round trip', () => {
  let root: string;
  let webserver: ChildProcess;
  let shards: string[];
  const url = 'http://127.0.0.1:16070';

  const repository = (id: string, content: string) => {
    const source = path.join(root, `${id}-source`);
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: source });

    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(path.join(source, 'a.ts'), content);
    git('add', '.');
    git('commit', '-qm', 'init');
    execFileSync('git', [
      'clone',
      '-q',
      '--bare',
      source,
      path.join(root, `${id}.git`),
    ]);
    return path.join(root, `${id}.git`);
  };

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-zoekt-'));
    const indexDir = path.join(root, 'index');

    shards = await indexRepository({
      indexDir,
      repoDirectory: repository('repo_public', 'const café = findMe();\n'),
      name: 'repo_public',
      isPublic: true,
    });
    await indexRepository({
      indexDir,
      repoDirectory: repository('repo_private', 'findMe();\n'),
      name: 'repo_private',
      isPublic: false,
    });

    webserver = spawn('zoekt-webserver', [
      '-index',
      indexDir,
      '-listen',
      '127.0.0.1:16070',
      '-rpc',
      '-html=false',
    ]);
    await vi.waitFor(
      async () => expect((await fetch(`${url}/healthz`)).ok).toBe(true),
      { timeout: 10_000, interval: 100 },
    );
  });

  afterAll(() => {
    webserver?.kill();
    rmSync(root, { recursive: true, force: true });
  });

  const searchUntil = (query: string, count: number) =>
    vi.waitFor(
      async () => {
        const files = await listMatchingFiles({ url, query });
        expect(files).toHaveLength(count);
        return searchFiles({ url, query, files });
      },
      { timeout: 10_000, interval: 100 },
    );

  it('names the shards after the repository', () => {
    expect(shards).toEqual(['repo_public_v16.00000.zoekt']);
  });

  it('finds a line in every indexed shard', async () => {
    const hits = await searchUntil('findMe', 2);

    expect(hits.map((hit) => hit.repositoryId).sort()).toEqual([
      'repo_private',
      'repo_public',
    ]);
  });

  it('narrows to shards flagged public', async () => {
    const [hit] = await searchUntil('public:yes findMe', 1);

    expect(hit).toEqual({
      repositoryId: 'repo_public',
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      path: 'a.ts',
      language: 'TypeScript',
      matchCount: 1,
      lines: [
        {
          lineNumber: 1,
          line: 'const café = findMe();',
          ranges: [{ start: 13, end: 19 }],
        },
      ],
    });
  });
});
