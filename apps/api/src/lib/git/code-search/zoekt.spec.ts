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
import { indexRepository, searchIndex } from './zoekt.js';

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
  const search = () =>
    searchIndex({ url: 'http://zoekt:6070', query: 'x', limit: 5 });

  it('returns no files when zoekt reports none', async () => {
    replyWith({ Result: { Files: null } });

    await expect(search()).resolves.toEqual([]);
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

    await expect(search()).resolves.toEqual([
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
    ]);
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
        const found = await searchIndex({ url, query, limit: 5 });
        expect(found).toHaveLength(count);
        return found;
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
