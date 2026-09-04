import { Cursor, Reader } from './cursor.js';
import { bytesToUlid, ulidToBytes } from './ulid.js';
import { WalCorruptError } from './wal.errors.js';
import {
  OID_LENGTH,
  PACK_SHA_LENGTH,
  type RefTransition,
  type WalEntryHeader,
  type WalIndex,
  type WalLayer,
} from './wal.types.js';

// ASCII "GWAL" and "GENT". Distinct per format so an entry read as an index
// fails at byte 0 instead of passing the version check and decoding garbage.
const INDEX_MAGIC = 0x4757414c;
const ENTRY_MAGIC = 0x47454e54;
const FORMAT_VERSION = 1;
const ULID_BYTES = 16;

export const INDEX_CONTENT_TYPE = 'application/vnd.ghost.wal-index';
export const ENTRY_CONTENT_TYPE = 'application/vnd.ghost.wal-entry';

/** Enough to cover any plausible header, for ranged metadata reads. */
export const ENTRY_HEADER_PROBE_BYTES = 64 * 1024;

export function encodeIndex(index: WalIndex): Buffer {
  let size = 4 + 1 + 1 + 8 + 8 + 4;
  for (const ref of index.refs.keys()) {
    size += 2 + Buffer.byteLength(ref, 'utf8') + OID_LENGTH;
  }
  size += 4 + index.layers.length * (ULID_BYTES + PACK_SHA_LENGTH + 8);

  const cursor = new Cursor(Buffer.allocUnsafe(size));
  cursor.u32(INDEX_MAGIC);
  cursor.u8(FORMAT_VERSION);
  cursor.u8(0);
  cursor.u64(index.seq);
  cursor.u64(index.compactedThroughSeq);

  cursor.u32(index.refs.size);
  for (const [ref, oid] of index.refs) {
    cursor.str(ref);
    cursor.bytes(oid);
  }

  cursor.u32(index.layers.length);
  for (const layer of index.layers) {
    cursor.bytes(ulidToBytes(layer.ulid));
    cursor.bytes(layer.packSha);
    cursor.u64(layer.size);
  }

  return cursor.buffer;
}

export function decodeIndex(buffer: Buffer): WalIndex {
  const reader = new Reader(buffer);
  if (reader.u32() !== INDEX_MAGIC) throw new WalCorruptError('bad index magic');

  const version = reader.u8();
  if (version !== FORMAT_VERSION) {
    throw new WalCorruptError(`unsupported index version ${version}`);
  }
  reader.u8();

  const seq = reader.u64();
  const compactedThroughSeq = reader.u64();

  const refs = new Map<string, Buffer>();
  for (let remaining = reader.u32(); remaining > 0; remaining--) {
    refs.set(reader.str(), reader.bytes(OID_LENGTH));
  }

  const layers: WalLayer[] = [];
  for (let remaining = reader.u32(); remaining > 0; remaining--) {
    layers.push({
      ulid: bytesToUlid(reader.bytes(ULID_BYTES)),
      packSha: reader.bytes(PACK_SHA_LENGTH),
      size: reader.u64(),
    });
  }

  return { seq, compactedThroughSeq, refs, layers };
}

export function encodeEntryHeader(header: WalEntryHeader): Buffer {
  const pushedBy = header.pushedBy ?? '';
  let size =
    4 + 1 + 4 + ULID_BYTES + 8 + 2 + Buffer.byteLength(pushedBy, 'utf8') + 4;
  for (const transition of header.transitions) {
    size += 2 + Buffer.byteLength(transition.ref, 'utf8') + OID_LENGTH * 2;
  }

  const cursor = new Cursor(Buffer.allocUnsafe(size));
  cursor.u32(ENTRY_MAGIC);
  cursor.u8(FORMAT_VERSION);
  cursor.u32(size);
  cursor.bytes(ulidToBytes(header.ulid));
  cursor.u64(header.createdAt);
  cursor.str(pushedBy);
  cursor.u32(header.transitions.length);
  for (const transition of header.transitions) {
    cursor.str(transition.ref);
    cursor.bytes(transition.oldOid);
    cursor.bytes(transition.newOid);
  }

  return cursor.buffer;
}

export function decodeEntryHeader(buffer: Buffer): {
  header: WalEntryHeader;
  packOffset: number;
} {
  const reader = new Reader(buffer);
  if (reader.u32() !== ENTRY_MAGIC) throw new WalCorruptError('bad entry magic');

  const version = reader.u8();
  if (version !== FORMAT_VERSION) {
    throw new WalCorruptError(`unsupported entry version ${version}`);
  }

  const packOffset = reader.u32();
  if (packOffset > buffer.length) {
    throw new WalCorruptError('entry header truncated');
  }

  const ulid = bytesToUlid(reader.bytes(ULID_BYTES));
  const createdAt = reader.u64();
  const pushedBy = reader.str();

  const transitions: RefTransition[] = [];
  for (let remaining = reader.u32(); remaining > 0; remaining--) {
    transitions.push({
      ref: reader.str(),
      oldOid: reader.bytes(OID_LENGTH),
      newOid: reader.bytes(OID_LENGTH),
    });
  }

  return {
    header: { ulid, createdAt, pushedBy: pushedBy || null, transitions },
    packOffset,
  };
}
