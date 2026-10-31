import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LoadedCodeowners } from '../../lib/codeowners/codeowners.js';
import { MAX_CODEOWNERS_BYTES } from '../../lib/codeowners/codeowners.js';
import { CodeownersService } from './codeowners.service.js';

describe('CodeownersService', () => {
  // Neither the database nor access is reached before a file is found.
  const service = new CodeownersService(null as never, null as never);
  let root: string;
  let gitDir: string;

  const commit = (files: Record<string, string>) => {
    const env = { ...process.env };
    delete env.GIT_DIR;
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    execFileSync('git', ['add', '-A'], { cwd: root, env });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=T',
        '-c',
        'user.email=t@example.com',
        'commit',
        '-q',
        '-m',
        'files',
      ],
      { cwd: root, env },
    );
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-codeowners-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('takes the first file in lookup order', async () => {
    commit({ 'docs/CODEOWNERS': '* @a\n', 'README.md': 'hi\n' });
    expect(await service.activePath(gitDir, 'main')).toBe('docs/CODEOWNERS');
    commit({ '.github/CODEOWNERS': '* @b\n', '.ghost/CODEOWNERS': '* @c\n' });
    expect(await service.activePath(gitDir, 'main')).toBe('.ghost/CODEOWNERS');
  });

  it('finds no file in a repository without one', async () => {
    commit({ 'README.md': 'hi\n' });
    expect(await service.activePath(gitDir, 'main')).toBeNull();
    expect(
      await service.load({ id: 'r', organizationId: null }, gitDir, 'main'),
    ).toBeNull();
  });

  it('treats a file over 3 MB as no file', async () => {
    commit({
      '.github/CODEOWNERS': `${'#'.repeat(MAX_CODEOWNERS_BYTES)}\n`,
      CODEOWNERS: '* @a\n',
    });
    expect(await service.activePath(gitDir, 'main')).toBeNull();
    expect(
      await service.load({ id: 'r', organizationId: null }, gitDir, 'main'),
    ).toBeNull();
  });

  it('owns a path by the last matching rule, leaving out owners that did not resolve and counting a user once', () => {
    const alice = { kind: 'user' as const, userId: 'u1', username: 'alice' };
    const loaded: LoadedCodeowners = {
      path: 'CODEOWNERS',
      errors: [],
      rules: [
        {
          line: 1,
          pattern: '*',
          owners: [{ kind: 'user', username: 'bob' }],
          ownerColumns: [3],
        },
        {
          line: 2,
          pattern: '*.ts',
          owners: [
            { kind: 'user', username: 'alice' },
            { kind: 'email', email: 'alice@example.com' },
            { kind: 'user', username: 'alcie' },
          ],
          ownerColumns: [6, 13, 31],
        },
      ],
      resolve: (owner) =>
        owner.kind === 'user' && owner.username === 'alcie'
          ? null
          : owner.kind === 'user' && owner.username === 'bob'
            ? { ...alice, userId: 'u2', username: 'bob' }
            : alice,
    };
    expect(service.ownersOf(loaded, 'src/a.ts')).toEqual([alice]);
    expect(service.ownersOf(loaded, 'README.md')).toEqual([
      { kind: 'user', userId: 'u2', username: 'bob' },
    ]);
    expect(service.ownersOf({ ...loaded, rules: [] }, 'README.md')).toEqual([]);
  });
});
