import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_BLOB_BYTES, readBlob, streamBlob } from './read-blob.js';

describe('readBlob', () => {
  let root: string;
  let gitDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-blob-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src/x.ts'), 'export const x = 1;\n');
    writeFileSync(path.join(root, 'logo.bin'), Buffer.from([0, 1, 2, 255]));
    writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(MAX_BLOB_BYTES + 1));
    git('add', '-A');
    git('commit', '-m', 'first commit');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads a file at a ref', async () => {
    const blob = await readBlob({ gitDir, ref: 'main', path: 'src/x.ts' });

    expect(blob?.size).toBe(20);
    expect(blob?.content?.toString('utf8')).toBe('export const x = 1;\n');
  });

  it('reads binary contents byte for byte', async () => {
    const blob = await readBlob({ gitDir, ref: 'main', path: 'logo.bin' });

    expect([...(blob?.content ?? [])]).toEqual([0, 1, 2, 255]);
  });

  it('reports size but no contents past the inline limit', async () => {
    const blob = await readBlob({ gitDir, ref: 'main', path: 'big.txt' });

    expect(blob?.size).toBe(MAX_BLOB_BYTES + 1);
    expect(blob?.content).toBeNull();
  });

  it('streams bytes past the inline limit', async () => {
    const big = await readBlob({ gitDir, ref: 'main', path: 'big.txt' });
    const chunks: Buffer[] = [];
    for await (const chunk of streamBlob({ gitDir, oid: big!.oid })) {
      chunks.push(chunk as Buffer);
    }

    expect(Buffer.concat(chunks).length).toBe(MAX_BLOB_BYTES + 1);
  });

  it('returns null for a directory, a missing path, and a missing ref', async () => {
    expect(await readBlob({ gitDir, ref: 'main', path: 'src' })).toBeNull();
    expect(await readBlob({ gitDir, ref: 'main', path: 'nope.ts' })).toBeNull();
    expect(
      await readBlob({ gitDir, ref: 'other', path: 'src/x.ts' }),
    ).toBeNull();
  });
});
