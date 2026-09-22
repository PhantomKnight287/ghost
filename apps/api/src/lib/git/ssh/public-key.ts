import { createHash, createPublicKey } from 'node:crypto';
import ssh2, { type ParsedKey } from 'ssh2';

// ssh2 is CommonJS: a named import type-checks and then fails to resolve at runtime under ESM.
const { parseKey } = ssh2.utils;

/** An uploaded key, reduced to what is stored. The algorithm is read back out of the blob rather than kept beside it, so the two can never disagree. */
export interface SshPublicKey {
  type: string;
  /** The key blob, base64, as the second field of an authorized_keys line. */
  blob: string;
  /** SHA256 of the blob, base64 without padding - what `ssh-keygen -lf` prints after `SHA256:`. */
  fingerprint: string;
  comment: string;
}

/** OpenSSH refuses these too: a 1024-bit RSA key is forgeable by anyone who wants a push badly enough. */
const MIN_RSA_MODULUS_BITS = 2048;

/** Reads one authorized_keys line. Throws with a reason a person can act on; the caller turns that into a domain error. */
export function readPublicKey(line: string): SshPublicKey {
  const text = line.trim();
  if (text.length === 0) throw new Error('the key is empty');

  const algorithm = text.split(/\s+/)[0];
  if (algorithm.endsWith('-cert-v01@openssh.com')) {
    throw new Error('certificates are not accepted, upload the key itself');
  }

  const parsed = parseKey(text);
  if (parsed instanceof Error) throw new Error(parsed.message);
  if (parsed.isPrivateKey()) {
    throw new Error('that is a private key - upload the .pub half instead');
  }

  const blob = parsed.getPublicSSH();
  if (parsed.type === 'ssh-rsa' && modulusBits(parsed) < MIN_RSA_MODULUS_BITS) {
    throw new Error(`RSA keys must be at least ${MIN_RSA_MODULUS_BITS} bits`);
  }

  return {
    type: parsed.type,
    blob: blob.toString('base64'),
    fingerprint: fingerprintOf(blob),
    comment: parsed.comment ?? '',
  };
}

/** The algorithm a stored blob names itself, for display and for rebuilding the key. */
export function keyTypeOf(blob: string) {
  return algorithmOf(Buffer.from(blob, 'base64'));
}

export function fingerprintOf(blob: Buffer) {
  return createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

/** Rebuilds a stored blob into something that can verify a signature. The algorithm is the blob's own first field, so the line is reconstructed rather than remembered. */
export function parseStoredKey(blob: string): ParsedKey {
  const decoded = Buffer.from(blob, 'base64');
  const parsed = parseKey(`${algorithmOf(decoded)} ${blob}`);
  if (parsed instanceof Error) throw parsed;
  return parsed;
}

/** ssh-string: four bytes of length, then that many bytes. The first one in any public key blob is its algorithm name. */
function algorithmOf(blob: Buffer) {
  if (blob.length < 4) throw new Error('key blob is truncated');
  const length = blob.readUInt32BE(0);
  if (length === 0 || length > 64 || blob.length < 4 + length) {
    throw new Error('key blob does not start with an algorithm name');
  }
  return blob.toString('ascii', 4, 4 + length);
}

function modulusBits(key: ParsedKey) {
  return (
    createPublicKey(key.getPublicPEM()).asymmetricKeyDetails?.modulusLength ?? 0
  );
}
