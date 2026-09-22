import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ssh2, { type ParsedKey } from 'ssh2';
import { afterAll, describe, expect, it } from 'vitest';

import {
  fingerprintOf,
  keyTypeOf,
  parseStoredKey,
  readPublicKey,
} from './public-key.js';

const directory = mkdtempSync(path.join(tmpdir(), 'ghost-ssh-spec-'));
let generated = 0;

function generate(type: string, bits?: string) {
  const file = path.join(directory, `${type}-${((generated += 1)).toString()}`);
  const args = ['-t', type, '-N', '', '-C', 'someone@laptop', '-f', file];
  execFileSync('ssh-keygen', bits ? [...args, '-b', bits] : args);
  return {
    line: readFileSync(`${file}.pub`, 'utf8'),
    private: readFileSync(file, 'utf8'),
    // `ssh-keygen -lf` prints "<bits> SHA256:<fingerprint> <comment> (<TYPE>)".
    fingerprint: execFileSync('ssh-keygen', ['-lf', `${file}.pub`], {
      encoding: 'utf8',
    })
      .split(' ')[1]
      .replace('SHA256:', ''),
  };
}

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('readPublicKey', () => {
  it('agrees with ssh-keygen about the fingerprint', () => {
    const generated = generate('ed25519');
    const key = readPublicKey(generated.line);

    expect(key.type).toBe('ssh-ed25519');
    expect(key.fingerprint).toBe(generated.fingerprint);
    expect(key.comment).toBe('someone@laptop');
  });

  it('stores the blob so its type can be read back without a second column', () => {
    const key = readPublicKey(generate('ecdsa').line);

    expect(keyTypeOf(key.blob)).toBe(key.type);
    expect(fingerprintOf(Buffer.from(key.blob, 'base64'))).toBe(
      key.fingerprint,
    );
  });

  it('verifies a signature made by the matching private key', () => {
    const generated = generate('ed25519');
    const stored = readPublicKey(generated.line);
    const data = Buffer.from(
      'the session identifier and the rest of the auth request',
    );

    const signature = (
      ssh2.utils.parseKey(generated.private) as ParsedKey
    ).sign(data);
    expect(parseStoredKey(stored.blob).verify(data, signature)).toBe(true);
    expect(
      parseStoredKey(stored.blob).verify(Buffer.from('other'), signature),
    ).toBe(false);
  });

  it('refuses a private key', () => {
    expect(() => readPublicKey(generate('ed25519').private)).toThrow(
      /private key/,
    );
  });

  it('refuses an RSA key below 2048 bits', () => {
    expect(() => readPublicKey(generate('rsa', '1024').line)).toThrow(
      /2048 bits/,
    );
  });

  it('refuses a certificate', () => {
    expect(() =>
      readPublicKey('ssh-ed25519-cert-v01@openssh.com AAAA nobody@nowhere'),
    ).toThrow(/certificates/);
  });

  it.each(['', 'not a key at all', 'ssh-ed25519 !!!notbase64!!!'])(
    'refuses %j',
    (line) => {
      expect(() => readPublicKey(line)).toThrow();
    },
  );
});
