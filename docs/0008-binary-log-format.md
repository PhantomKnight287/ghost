# 0008 — The log is a binary format

**Status:** adopted

## Decision

Both the index and entry headers are hand-rolled binary, not JSON. Big-endian,
magic-prefixed, versioned. `wal-codec.ts` owns encode and decode; `cursor.ts`
provides the read/write primitives.

## Why

Replay reads the index on **every push and every materialization**. Object IDs
dominate its size, and JSON forces them to hex: 40 bytes where 20 will do, plus
quoting and key names. Binary halves the oid cost outright and removes parse
overhead from the hot path.

The `Cursor`/`Reader` pair exists because the alternative is offset arithmetic
inline at every field, which reliably produces an off-by-one that corrupts a
log rather than throwing.

## Index layout

```
magic              u32   "GWAL"
version            u8
flags              u8
seq                u64
compactedThroughSeq u64
refCount           u32
  refName          u16 length + utf8
  oid              20 raw bytes
layerCount         u32
  ulid             16 raw bytes
  packSha          32 raw bytes
  size             u64
```

## Entry layout

```
magic       u32   "GENT"
version     u8
headerLen   u32   ← the packfile begins at exactly this offset
ulid        16 raw bytes
createdAt   u64
pushedBy    u16 length + utf8
transitionCount u32
  refName   u16 length + utf8
  oldOid    20 raw bytes
  newOid    20 raw bytes
<packfile bytes>
```

`headerLen` up front buys a real capability: entry metadata is readable with
`Range: bytes=0-65535` instead of downloading a half-gigabyte packfile.
`WalStoreService.readEntryHeader` does exactly that.

## Two fields that look like overhead and are not

- **`version`** is checked on decode and an unknown value throws
  `WalCorruptError`. A log format that cannot be versioned cannot be evolved.
- **`flags`** is currently zero. Bit 0 is reserved for the sha1 → sha256 object
  format switch. Retrofitting a hash-length change without a flag byte means
  rewriting every object in every repository.

## Consequence

The format is now an on-disk contract. Any change to it needs a version bump and
a decoder that handles both. `wal-codec.spec.ts` round-trips every shape,
including the empty index, and asserts that oids are stored as raw bytes rather
than hex.
