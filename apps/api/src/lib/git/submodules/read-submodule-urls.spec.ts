import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSubmoduleUrls } from './read-submodule-urls.js';

describe('readSubmoduleUrls', () => {
  let root: string;
  let gitDir: string;
  let commit: (gitmodules: string) => void;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-submodules-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(path.join(root, 'README.md'), 'hello\n');
    git('add', '-A');
    git('commit', '-qm', 'first commit');

    commit = (gitmodules) => {
      writeFileSync(path.join(root, '.gitmodules'), gitmodules);
      git('add', '-A');
      git('commit', '-qm', 'gitmodules');
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('maps each submodule path to its URL', async () => {
    commit(
      [
        '[submodule "vendor.lib"]',
        '\tpath = vendor/lib',
        '\turl = ../lib.git',
        '[submodule "docs"]',
        '\turl = https://github.com/octo/docs.git',
        '\tpath = docs',
      ].join('\n'),
    );

    expect(await readSubmoduleUrls({ gitDir, ref: 'main' })).toEqual(
      new Map([
        ['vendor/lib', '../lib.git'],
        ['docs', 'https://github.com/octo/docs.git'],
      ]),
    );
  });

  it('leaves out a submodule missing its path or its URL', async () => {
    commit(
      [
        '[submodule "no-url"]',
        '\tpath = a',
        '[submodule "no-path"]',
        '\turl = ../b.git',
        '[submodule "valueless"]',
        '\tpath = c',
        '\turl',
      ].join('\n'),
    );

    expect(await readSubmoduleUrls({ gitDir, ref: 'main' })).toEqual(new Map());
  });

  it('is empty for a ref without .gitmodules', async () => {
    expect(await readSubmoduleUrls({ gitDir, ref: 'main' })).toEqual(new Map());
  });

  it('is empty for a .gitmodules git cannot parse', async () => {
    commit('[submodule "broken\n\tpath = a\n');

    expect(await readSubmoduleUrls({ gitDir, ref: 'main' })).toEqual(new Map());
  });
});
