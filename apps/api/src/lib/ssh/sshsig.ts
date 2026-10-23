import { createHash, createPublicKey, verify } from 'node:crypto';

import { keyTypeOf, parseStoredKey } from '../git/ssh/public-key.js';

export const SSH_SIGNATURE_HEADER = '-----BEGIN SSH SIGNATURE-----';
const MAGIC = Buffer.from('SSHSIG');

/** An OpenSSH `sshsig` signature (PROTOCOL.sshsig), as git writes one with `gpg.format=ssh`. */
export type SshSignature = {
  /** The signer's public key blob, as an authorized_keys line's second field holds it, decoded. */
  publicKey: Buffer;
  namespace: string;
  hashAlgorithm: 'sha256' | 'sha512';
  /** The signature algorithm, such as `ssh-ed25519` or `rsa-sha2-512`. */
  algorithm: string;
  signature: Buffer;
};

/** Parses an armored `-----BEGIN SSH SIGNATURE-----` block; null when it is not one or does not parse. */
export function readSshSignature(armored: string): SshSignature | null {
  const text = armored.trim();
  if (!text.startsWith(SSH_SIGNATURE_HEADER)) return null;
  const blob = Buffer.from(
    text
      .split('\n')
      .filter((line) => !line.startsWith('-----'))
      .join(''),
    'base64',
  );
  try {
    if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) return null;
    const reader = new SshReader(blob, MAGIC.length);
    if (reader.uint32() !== 1) return null;
    const publicKey = reader.string();
    const namespace = reader.string().toString('utf8');
    reader.string();
    const hashAlgorithm = reader.string().toString('ascii');
    if (hashAlgorithm !== 'sha256' && hashAlgorithm !== 'sha512') return null;
    const wrapped = new SshReader(reader.string());
    const parsed = {
      publicKey,
      namespace,
      hashAlgorithm,
      algorithm: wrapped.string().toString('ascii'),
      signature: wrapped.string(),
    } as const;
    // OpenSSH refuses trailing bytes; accepting them would let anyone re-encode a signature into a new commit that still verifies.
    return reader.done() && wrapped.done() ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether `signature` signs `payload` under namespace `git` with the key it embeds. Which account owns that key is the caller's question. */
export function verifySshSignature(
  payload: string,
  signature: SshSignature,
): boolean {
  if (signature.namespace !== 'git') return false;
  const signed = Buffer.concat([
    MAGIC,
    sshString(Buffer.from(signature.namespace)),
    sshString(Buffer.alloc(0)),
    sshString(Buffer.from(signature.hashAlgorithm)),
    sshString(
      createHash(signature.hashAlgorithm).update(payload, 'utf8').digest(),
    ),
  ]);
  try {
    const key = createPublicKey(
      parseStoredKey(signature.publicKey.toString('base64')).getPublicPEM(),
    );
    const { algorithm } = signature;
    const keyType = keyTypeOf(signature.publicKey.toString('base64'));
    if (
      keyType !== algorithm &&
      !(keyType === 'ssh-rsa' && algorithm.startsWith('rsa-sha2-'))
    )
      return false;
    if (algorithm === 'ssh-ed25519')
      return verify(null, signed, key, signature.signature);
    if (algorithm === 'rsa-sha2-256' || algorithm === 'rsa-sha2-512')
      return verify(
        algorithm === 'rsa-sha2-256' ? 'sha256' : 'sha512',
        signed,
        key,
        signature.signature,
      );
    const curve = ECDSA_CURVES[algorithm];
    if (!curve) return false;
    // The signature blob holds r and s as SSH mpints; Node takes them as one fixed-width r||s.
    const parts = new SshReader(signature.signature);
    const r = fixedWidth(parts.string(), curve.bytes);
    const sValue = fixedWidth(parts.string(), curve.bytes);
    if (!r || !sValue || !parts.done()) return false;
    return verify(
      curve.hash,
      signed,
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.concat([r, sValue]),
    );
  } catch {
    return false;
  }
}

// ponytail: security keys (sk-ssh-ed25519, sk-ecdsa) sign extra flags and a counter; add them when someone signs with one.
const ECDSA_CURVES: Record<string, { hash: string; bytes: number }> = {
  'ecdsa-sha2-nistp256': { hash: 'sha256', bytes: 32 },
  'ecdsa-sha2-nistp384': { hash: 'sha384', bytes: 48 },
  'ecdsa-sha2-nistp521': { hash: 'sha512', bytes: 66 },
};

/** An SSH mpint as `bytes` big-endian bytes; null when it is wider, beyond the one zero byte that keeps it positive, so one signature has one encoding. */
function fixedWidth(mpint: Buffer, bytes: number) {
  const extra = mpint.length - bytes;
  if (extra > 1 || (extra === 1 && mpint[0] !== 0)) return null;
  const unsigned = mpint.subarray(Math.max(0, extra));
  return Buffer.concat([Buffer.alloc(bytes - unsigned.length), unsigned]);
}

function sshString(value: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}

class SshReader {
  constructor(
    private readonly buffer: Buffer,
    private offset = 0,
  ) {}

  uint32() {
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  done() {
    return this.offset === this.buffer.length;
  }

  string() {
    const length = this.uint32();
    if (this.offset + length > this.buffer.length)
      throw new Error('ssh string runs past the end');
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}
