import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveRevision } from './resolve-ref.js';

describe('resolveRevision', () => {
  let root: string;
  let gitDir: string;
  let sha: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-rev-'));
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
    git('commit', '-m', 'first commit');
    sha = git('rev-parse', 'HEAD').trim();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('resolves a branch name to its full ref', async () => {
    await expect(
      resolveRevision({ gitDir, branches: ['main'], requested: 'main' }),
    ).resolves.toEqual({ ref: 'refs/heads/main', detached: false });
  });

  it('accepts an already-qualified branch ref', async () => {
    await expect(
      resolveRevision({
        gitDir,
        branches: ['main'],
        requested: 'refs/heads/main',
      }),
    ).resolves.toEqual({ ref: 'refs/heads/main', detached: false });
  });

  it('resolves a commit sha, and an abbreviated one, as detached', async () => {
    await expect(
      resolveRevision({ gitDir, branches: ['main'], requested: sha }),
    ).resolves.toEqual({ ref: sha, detached: true });

    await expect(
      resolveRevision({
        gitDir,
        branches: ['main'],
        requested: sha.slice(0, 8),
      }),
    ).resolves.toEqual({ ref: sha, detached: true });
  });

  it('returns null for an unknown branch, an unknown sha and a flag', async () => {
    for (const requested of ['nope', 'a'.repeat(40), '--all']) {
      await expect(
        resolveRevision({ gitDir, branches: ['main'], requested }),
      ).resolves.toBeNull();
    }
  });
});
