import { describe, expect, it } from 'vitest';

import {
  ECDSA_GIT_SIGNATURE,
  ED25519_FILE_SIGNATURE,
  ED25519_GIT_SIGNATURE,
  ED25519_PUBLIC_KEY,
  RSA_GIT_SIGNATURE,
  RSA_PUBLIC_KEY,
  SIGNED_PAYLOAD,
} from './__fixtures__/ssh-signatures.js';
import { SIGNED_COMMIT_OBJECT } from '../gpg/__fixtures__/signed-commit.js';
import { readPublicKey } from '../git/ssh/public-key.js';
import { readSshSignature, verifySshSignature } from './sshsig.js';

const blobOf = (line: string) => readPublicKey(line).blob;

describe('readSshSignature', () => {
  it('reads the signer key and namespace out of the blob', () => {
    const signature = readSshSignature(ED25519_GIT_SIGNATURE);
    expect(signature?.namespace).toBe('git');
    expect(signature?.publicKey.toString('base64')).toBe(
      blobOf(ED25519_PUBLIC_KEY),
    );
  });

  it('returns null for an OpenPGP signature', () => {
    const pgp = SIGNED_COMMIT_OBJECT.slice(
      SIGNED_COMMIT_OBJECT.indexOf('-----BEGIN PGP'),
    );
    expect(readSshSignature(pgp)).toBeNull();
  });

  it('returns null for garbage inside the armor', () => {
    expect(
      readSshSignature(
        '-----BEGIN SSH SIGNATURE-----\nbm9wZQ==\n-----END SSH SIGNATURE-----',
      ),
    ).toBeNull();
  });
});

describe('verifySshSignature', () => {
  it.each([
    ['Ed25519', ED25519_GIT_SIGNATURE],
    ['RSA', RSA_GIT_SIGNATURE],
    ['ECDSA P-256', ECDSA_GIT_SIGNATURE],
  ])('verifies an %s signature under namespace git', (_, armored) => {
    const signature = readSshSignature(armored);
    expect(signature).not.toBeNull();
    expect(verifySshSignature(SIGNED_PAYLOAD, signature!)).toBe(true);
  });

  it('refuses a signature made for another namespace', () => {
    expect(
      verifySshSignature(
        SIGNED_PAYLOAD,
        readSshSignature(ED25519_FILE_SIGNATURE)!,
      ),
    ).toBe(false);
  });

  it('refuses a changed payload', () => {
    expect(
      verifySshSignature(
        SIGNED_PAYLOAD.replace('signed', 'forged'),
        readSshSignature(ED25519_GIT_SIGNATURE)!,
      ),
    ).toBe(false);
  });

  it('refuses a signature whose embedded key was swapped', () => {
    const signature = readSshSignature(ED25519_GIT_SIGNATURE)!;
    const other = Buffer.from(blobOf(RSA_PUBLIC_KEY), 'base64');
    expect(
      verifySshSignature(SIGNED_PAYLOAD, { ...signature, publicKey: other }),
    ).toBe(false);
  });

  const reencode = (mutate: (blob: Buffer) => Buffer) => {
    const body = Buffer.from(
      ED25519_GIT_SIGNATURE.trim()
        .split('\n')
        .filter((line) => !line.startsWith('-----'))
        .join(''),
      'base64',
    );
    return `-----BEGIN SSH SIGNATURE-----\n${mutate(body).toString('base64')}\n-----END SSH SIGNATURE-----\n`;
  };

  it('refuses a blob with bytes after the signature', () => {
    const padded = reencode((blob) => Buffer.concat([blob, Buffer.from([0])]));
    expect(readSshSignature(padded)).toBeNull();
  });

  it('refuses a signature algorithm that does not match the key', () => {
    const signature = readSshSignature(ED25519_GIT_SIGNATURE)!;
    expect(
      verifySshSignature(SIGNED_PAYLOAD, {
        ...signature,
        publicKey: Buffer.from(blobOf(RSA_PUBLIC_KEY), 'base64'),
        algorithm: 'ssh-ed25519',
      }),
    ).toBe(false);
  });

  it('refuses an ECDSA signature whose integers carry extra leading bytes', () => {
    const signature = readSshSignature(ECDSA_GIT_SIGNATURE)!;
    const mpint = (value: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(value.length);
      return Buffer.concat([length, value]);
    };
    const reader = (buffer: Buffer) => {
      const first = buffer.readUInt32BE(0);
      const r = buffer.subarray(4, 4 + first);
      const s = buffer.subarray(
        8 + first,
        8 + first + buffer.readUInt32BE(4 + first),
      );
      return { r, s };
    };
    const { r, s: sValue } = reader(signature.signature);
    const padded = Buffer.concat([
      mpint(Buffer.concat([Buffer.from([7, 7]), r])),
      mpint(sValue),
    ]);
    expect(
      verifySshSignature(SIGNED_PAYLOAD, { ...signature, signature: padded }),
    ).toBe(false);
  });
});
