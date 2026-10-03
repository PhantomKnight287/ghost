import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GITHUB_EXPIRED_KEY_COMMIT,
  GITHUB_MERGE_COMMIT_OBJECT,
} from '../../gpg/__fixtures__/github-commits.js';
import {
  SIGNED_COMMIT_OBJECT,
  SIGNING_PUBLIC_KEY,
} from '../../gpg/__fixtures__/signed-commit.js';
import { GITHUB_WEB_FLOW_KEYS } from '../../gpg/github-web-flow.js';
import { verifySignature } from '../../gpg/openpgp.js';
import {
  insertSignature,
  readSignedCommits,
  splitSignature,
} from './commit-signature.js';

describe('splitSignature', () => {
  it('splits a real git signature from what it covers', () => {
    const signed = splitSignature(SIGNED_COMMIT_OBJECT);

    expect(signed?.signature.startsWith('-----BEGIN PGP SIGNATURE-----')).toBe(
      true,
    );
    expect(
      signed?.signature.trimEnd().endsWith('-----END PGP SIGNATURE-----'),
    ).toBe(true);
    // The payload is the commit as it would read without the header.
    expect(signed?.payload).not.toContain('gpgsig');
    expect(signed?.payload).toContain('tree ');
    expect(signed?.payload).toContain('signed commit');
  });

  it('verifies against the key that signed it', async () => {
    const signed = splitSignature(SIGNED_COMMIT_OBJECT);

    await expect(
      verifySignature({
        payload: signed!.payload,
        armoredSignature: signed!.signature,
        armoredKey: SIGNING_PUBLIC_KEY,
      }),
    ).resolves.toBe(true);
  });

  it('rejects a payload that was edited after signing', async () => {
    const signed = splitSignature(SIGNED_COMMIT_OBJECT);

    await expect(
      verifySignature({
        payload: signed!.payload.replace('signed commit', 'signed commi7'),
        armoredSignature: signed!.signature,
        armoredKey: SIGNING_PUBLIC_KEY,
      }),
    ).resolves.toBe(false);
  });

  it("verifies GitHub's merge commits under its current and its expired web-flow key", async () => {
    const merge = splitSignature(GITHUB_MERGE_COMMIT_OBJECT);

    await expect(
      verifySignature({
        payload: merge!.payload,
        armoredSignature: merge!.signature,
        armoredKey: GITHUB_WEB_FLOW_KEYS,
      }),
    ).resolves.toBe(true);
    await expect(
      verifySignature({
        payload: GITHUB_EXPIRED_KEY_COMMIT.payload,
        armoredSignature: GITHUB_EXPIRED_KEY_COMMIT.signature,
        armoredKey: GITHUB_WEB_FLOW_KEYS,
      }),
    ).resolves.toBe(true);
  });

  it('is null for an unsigned commit', () => {
    expect(
      splitSignature(
        'tree abc\nauthor A <a@b.c> 1 +0000\n\nmentions gpgsig in the body\n',
      ),
    ).toBeNull();
  });

  it('ignores an SSH signature, which this does not verify', () => {
    const commit = SIGNED_COMMIT_OBJECT.replace(
      '-----BEGIN PGP SIGNATURE-----',
      '-----BEGIN SSH SIGNATURE-----',
    );

    expect(splitSignature(commit)).toBeNull();
  });
});

describe('insertSignature', () => {
  it('puts back exactly the header splitSignature takes out', () => {
    const signed = splitSignature(SIGNED_COMMIT_OBJECT)!;

    expect(insertSignature(signed.payload, signed.signature)).toBe(
      SIGNED_COMMIT_OBJECT,
    );
  });

  it('refuses an object with no end to its headers rather than corrupt it', () => {
    expect(() =>
      insertSignature('tree abc\nauthor A <a@b.c> 1 +0000', 'signature'),
    ).toThrow('no blank line');
  });
});

describe('readSignedCommits', () => {
  let root: string;
  let gitDir: string;
  let git: (...args: string[]) => string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ghost-sig-'));
    gitDir = path.join(root, '.git');
    const env = { ...process.env };
    delete env.GIT_DIR;
    git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('config', 'user.email', 'test@ghost.local');
    git('config', 'user.name', 'Ghost Test');
    // The machine running the tests may sign by default.
    git('commit', '-q', '--no-gpg-sign', '--allow-empty', '-m', 'unsigned');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns only the commits that carry a signature', async () => {
    const unsigned = git('rev-parse', 'HEAD').trim();
    // The fixture object is written straight in, so the test needs no gpg.
    const signed = execFileSync(
      'git',
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      { cwd: root, input: SIGNED_COMMIT_OBJECT, encoding: 'utf8' },
    ).trim();

    const found = await readSignedCommits({
      gitDir,
      shas: [unsigned, signed, 'f'.repeat(40)],
    });

    expect([...found.keys()]).toEqual([signed]);
    expect(found.get(signed)?.payload).toContain('signed commit');
  });

  it('is empty when nothing was asked for', async () => {
    await expect(readSignedCommits({ gitDir, shas: [] })).resolves.toEqual(
      new Map(),
    );
  });
});
