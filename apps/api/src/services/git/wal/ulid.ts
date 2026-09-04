import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_BYTES = 16;
const ULID_CHARS = 26;

export function createUlid(now = Date.now()): string {
  const bytes = Buffer.alloc(ULID_BYTES);
  bytes.writeUIntBE(now, 0, 6);
  randomBytes(10).copy(bytes, 6);
  return bytesToUlid(bytes);
}

export function ulidToBytes(ulid: string): Buffer {
  if (ulid.length !== ULID_CHARS) {
    throw new TypeError(`ulid must be ${ULID_CHARS} characters, got ${ulid.length}`);
  }
  let bits = 0n;
  for (const char of ulid) {
    const value = ENCODING.indexOf(char);
    if (value === -1) throw new TypeError(`invalid ulid character ${char}`);
    bits = (bits << 5n) | BigInt(value);
  }
  const bytes = Buffer.alloc(ULID_BYTES);
  for (let i = ULID_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return bytes;
}

export function bytesToUlid(bytes: Buffer): string {
  if (bytes.length !== ULID_BYTES) {
    throw new TypeError(`ulid must be ${ULID_BYTES} bytes, got ${bytes.length}`);
  }
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  // 26 base32 characters hold 130 bits; the leading 2 are always zero.
  let ulid = '';
  for (let i = 0; i < ULID_CHARS; i++) {
    ulid = ENCODING[Number(bits & 0x1fn)] + ulid;
    bits >>= 5n;
  }
  return ulid;
}
