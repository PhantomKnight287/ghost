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
import { indexRepository, MAX_SEARCH_FILES, searchIndex } from './zoekt.js';

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

describe('searchIndex', () => {
  afterEach(() => vi.unstubAllGlobals());

  const replyWith = (body: unknown, status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
      ),
    );
  const search = ({ offset = 0, limit = 5 } = {}) =>
    searchIndex({ url: 'http://zoekt:6070', query: 'x', offset, limit });
  const file = (FileName: string) => ({
    FileName,
    Repository: 'repo_a',
    Version: 'c1',
    Language: 'TypeScript',
  });

  it('returns no files when zoekt reports none', async () => {
    replyWith({ Result: { Files: null } });

    await expect(search()).resolves.toEqual({ files: [], hasMore: false });
  });

  it('asks for one file past the page and returns only the page', async () => {
    replyWith({ Result: { Files: ['a', 'b', 'c', 'd'].map(file) } });

    const { files, hasMore } = await search({ offset: 1, limit: 2 });

    expect(files.map((hit) => hit.path)).toEqual(['b', 'c']);
    expect(hasMore).toBe(true);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
    ).toEqual({ Q: 'x', Opts: { MaxDocDisplayCount: 4 } });
  });

  it('has no more once zoekt runs out of files', async () => {
    replyWith({ Result: { Files: ['a', 'b'].map(file) } });

    await expect(search({ offset: 1, limit: 2 })).resolves.toMatchObject({
      hasMore: false,
    });
  });

  it('stops at the file cap', async () => {
    replyWith({ Result: { Files: [] } });

    await expect(
      search({ offset: MAX_SEARCH_FILES - 1, limit: 5 }),
    ).resolves.toEqual({ files: [], hasMore: false });
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
    ).toEqual({ Q: 'x', Opts: { MaxDocDisplayCount: MAX_SEARCH_FILES + 1 } });
  });

  it('turns many byte offsets on one line into string offsets, whatever their order', async () => {
    const line = 'é€x'.repeat(1000);
    const at = (i: number) => ({
      LineOffset: i * Buffer.byteLength('é€x') + Buffer.byteLength('é€'),
      MatchLength: 1,
    });
    replyWith({
      Result: {
        Files: [
          {
            ...file('a'),
            LineMatches: [
              {
                Line: b64(line),
                LineNumber: 1,
                FileName: false,
                LineFragments: [999, 0, 1].map(at),
              },
            ],
          },
        ],
      },
    });

    const { files } = await search();

    expect(files[0].lines[0].ranges).toEqual([
      { start: 2, end: 3 },
      { start: 5, end: 6 },
      { start: 2999, end: 3000 },
    ]);
    for (const { start, end } of files[0].lines[0].ranges) {
      expect(line.slice(start, end)).toBe('x');
    }
  });

  it('orders lines by line number', async () => {
    const match = (LineNumber: number) => ({
      Line: b64(`line ${LineNumber}\n`),
      LineNumber,
      FileName: false,
      LineFragments: [],
    });
    replyWith({
      Result: {
        Files: [{ ...file('a'), LineMatches: [1, 10, 2, 3].map(match) }],
      },
    });

    const { files } = await search();

    expect(files[0].lines.map((line) => line.lineNumber)).toEqual([
      1, 2, 3, 10,
    ]);
  });

  it('decodes lines and turns byte offsets into string offsets', async () => {
    const line = 'const café = findMe();';
    replyWith({
      Result: {
        Files: [
          {
            FileName: 'a.ts',
            Repository: 'repo_a',
            Version: 'c1',
            Language: 'TypeScript',
            LineMatches: [
              {
                Line: b64('a.ts'),
                LineNumber: 0,
                FileName: true,
                LineFragments: [{ LineOffset: 0, MatchLength: 4 }],
              },
              {
                Line: b64(`${line}\n`),
                LineNumber: 3,
                FileName: false,
                LineFragments: [
                  {
                    LineOffset: Buffer.byteLength('const café = '),
                    MatchLength: 6,
                  },
                ],
              },
            ],
          },
          {
            FileName: 'b.ts',
            Repository: 'repo_a',
            Version: 'c1',
            Language: 'TypeScript',
          },
        ],
      },
    });

    await expect(search()).resolves.toEqual({
      hasMore: false,
      files: [
        {
          repositoryId: 'repo_a',
          commit: 'c1',
          path: 'a.ts',
          language: 'TypeScript',
          lines: [
            {
              lineNumber: 3,
              line,
              ranges: [{ start: 13, end: 19 }],
            },
          ],
        },
        {
          repositoryId: 'repo_a',
          commit: 'c1',
          path: 'b.ts',
          language: 'TypeScript',
          lines: [],
        },
      ],
    });
  });

  it('rejects a query zoekt cannot parse', async () => {
    replyWith({ Error: 'unbalanced )' }, 400);

    await expect(search()).rejects.toBeInstanceOf(InvalidSearchQueryError);
  });

  it('is unavailable when zoekt fails', async () => {
    replyWith('oops', 500);

    await expect(search()).rejects.toMatchObject({
      constructor: CodeSearchUnavailableError,
      cause: new Error('zoekt answered 500: oops'),
    });
  });

  it('is unavailable when zoekt cannot be reached', async () => {
    const refused = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(refused));

    await expect(search()).rejects.toMatchObject({
      constructor: CodeSearchUnavailableError,
      cause: refused,
    });
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
        const { files } = await searchIndex({
          url,
          query,
          offset: 0,
          limit: 5,
        });
        expect(files).toHaveLength(count);
        return files;
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
