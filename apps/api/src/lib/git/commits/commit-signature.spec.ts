import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as openpgp from 'openpgp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  GITHUB_EXPIRED_KEY_COMMIT,
  GITHUB_MERGE_COMMIT_OBJECT,
} from '../../gpg/__fixtures__/github-commits.js';
import {
  SIGNED_COMMIT_OBJECT,
  SIGNING_PUBLIC_KEY,
} from '../../gpg/__fixtures__/signed-commit.js';
import { GITHUB_WEB_FLOW_KEYS } from '../../gpg/github-web-flow.js';
import { signPayload, verifySignature } from '../../gpg/openpgp.js';
import {
  insertSignature,
  readSignedCommits,
  splitSignature,
  splitTagSignature,
} from './commit-signature.js';

const TAG_PAYLOAD = `object ${'a'.repeat(40)}\ntype commit\ntag v1.0.0\ntagger Spec <spec@ghost.local> 1700000000 +0000\n\nFirst release\n`;

let tagKey: openpgp.PrivateKey;
let tagPublicKey: string;

beforeAll(async () => {
  const generated = await openpgp.generateKey({
    userIDs: [{ name: 'Spec', email: 'spec@ghost.local' }],
    format: 'object',
  });
  tagKey = generated.privateKey;
  tagPublicKey = generated.publicKey.armor();
});

/** A tag object the way `git tag -s` writes one: the armored signature appended after the message. */
async function signTag(payload = TAG_PAYLOAD) {
  return `${payload}${await signPayload({ payload, privateKey: tagKey })}`;
}

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

  it('splits an SSH signature, marking its format', () => {
    const commit = SIGNED_COMMIT_OBJECT.replace(
      '-----BEGIN PGP SIGNATURE-----',
      '-----BEGIN SSH SIGNATURE-----',
    );

    expect(splitSignature(commit)?.format).toBe('ssh');
    expect(splitSignature(SIGNED_COMMIT_OBJECT)?.format).toBe('openpgp');
  });

  it('ignores an X.509 signature, which this does not verify', () => {
    const commit = SIGNED_COMMIT_OBJECT.replace(
      '-----BEGIN PGP SIGNATURE-----',
      '-----BEGIN SIGNED MESSAGE-----',
    );

    expect(splitSignature(commit)).toBeNull();
  });
});

describe('splitTagSignature', () => {
  it('splits the trailing signature block from the tag it covers', async () => {
    const signed = splitTagSignature(await signTag());

    expect(signed?.format).toBe('openpgp');
    expect(signed?.payload).toBe(TAG_PAYLOAD);
    expect(signed?.signature.startsWith('-----BEGIN PGP SIGNATURE-----')).toBe(
      true,
    );
    expect(
      signed?.signature.trimEnd().endsWith('-----END PGP SIGNATURE-----'),
    ).toBe(true);
  });

  it('verifies against the key that signed it', async () => {
    const signed = splitTagSignature(await signTag())!;

    await expect(
      verifySignature({
        payload: signed.payload,
        armoredSignature: signed.signature,
        armoredKey: tagPublicKey,
      }),
    ).resolves.toBe(true);
  });

  it('takes the last BEGIN line as the signature when the message quotes one earlier', async () => {
    const quoting = TAG_PAYLOAD.replace(
      'First release\n',
      'First release\n\n-----BEGIN PGP SIGNATURE-----\nquoted, not a signature\n-----END PGP SIGNATURE-----\n',
    );

    const signed = splitTagSignature(await signTag(quoting))!;

    expect(signed.payload).toBe(quoting);
    await expect(
      verifySignature({
        payload: signed.payload,
        armoredSignature: signed.signature,
        armoredKey: tagPublicKey,
      }),
    ).resolves.toBe(true);
  });

  it('marks an SSH signature', () => {
    const tag = `${TAG_PAYLOAD}-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----\n`;

    expect(splitTagSignature(tag)).toEqual({
      payload: TAG_PAYLOAD,
      signature:
        '-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----\n',
      format: 'ssh',
    });
  });

  it('is null for an unsigned tag, even one that mentions a BEGIN line mid-sentence', () => {
    expect(splitTagSignature(TAG_PAYLOAD)).toBeNull();
    expect(
      splitTagSignature(
        TAG_PAYLOAD.replace(
          'First release',
          'See the -----BEGIN PGP SIGNATURE----- block',
        ),
      ),
    ).toBeNull();
  });

  it('ignores an X.509 signature, which this does not verify', () => {
    expect(
      splitTagSignature(
        `${TAG_PAYLOAD}-----BEGIN SIGNED MESSAGE-----\nMIIB\n-----END SIGNED MESSAGE-----\n`,
      ),
    ).toBeNull();
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

  it('reads signed tag objects by the trailing-block rule', async () => {
    const commit = git('rev-parse', 'HEAD').trim();
    const payload = TAG_PAYLOAD.replace('a'.repeat(40), commit);
    const tag = execFileSync(
      'git',
      ['hash-object', '-t', 'tag', '-w', '--stdin'],
      { cwd: root, input: await signTag(payload), encoding: 'utf8' },
    ).trim();
    const unsignedTag = execFileSync(
      'git',
      ['hash-object', '-t', 'tag', '-w', '--stdin'],
      {
        cwd: root,
        input: payload.replace('v1.0.0', 'v0.9.0'),
        encoding: 'utf8',
      },
    ).trim();

    const found = await readSignedCommits({
      gitDir,
      shas: [tag, unsignedTag],
    });

    expect([...found.keys()]).toEqual([tag]);
    expect(found.get(tag)).toMatchObject({ payload, format: 'openpgp' });
  });

  it('is empty when nothing was asked for', async () => {
    await expect(readSignedCommits({ gitDir, shas: [] })).resolves.toEqual(
      new Map(),
    );
  });
});
