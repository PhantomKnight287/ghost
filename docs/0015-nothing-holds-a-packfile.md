# 0015 — Nothing holds a packfile in memory

**Status:** adopted — fixes a hard failure above 2 GiB

## Decision

A push body is spooled to a temp file by middleware and passed down as a
`GitRequestBody` — `{ size, open(start?) }` — never a `Buffer`. Hashing,
uploading, and replay all stream.

## What broke

Pushing the Next.js repository (2.25 GiB packfile):

```
RangeError: data is too long
    at Hash.update (node:internal/crypto/hash:144:22)
    at PushTransactionService.commitPush (push-transaction.service.ts:46)
  code: 'ERR_OUT_OF_RANGE'
```

Line 144 is the native call. Node's C++ `Hash::HashUpdate` throws
`data is too long` when the input exceeds `INT_MAX` — 2,147,483,647 bytes. The
pack was 2,415,919,104.

`createHash('sha256').update(pack)` was never going to survive a real
repository, and [0011](0011-deferred.md) said so: *"caps repository size at
process heap… the first thing that breaks at scale."* This is that.

## Every place a large pack was fatal

Fixing the hash alone would have moved the failure one line down. All of these
were 2 GiB landmines and all are now streams:

| Was | Now |
|---|---|
| `readStream(req)` into a Buffer | spooled to a temp file |
| `createHash().update(pack)` | `pipeline(body.open(offset), hash)` |
| `Buffer.concat([header, pack])` | `prefixed()` — an async generator |
| `putObject({ Body: buffer })` | `Body` stream + explicit `ContentLength` |
| `readEntryPack()` → Buffer | `openEntryPack()` → ranged GET stream |
| `runGit({ input: Buffer })` | `input: Buffer \| Readable` |

## Why `GitRequestBody` rather than a `Readable`

The push path needs the body twice: once to read the command section, once to
feed `receive-pack`. And the WAL needs the packfile alone, from `packOffset`
onward. A single-pass `Readable` cannot serve that, but neither may the handler
hold the bytes.

`{ size, open(start?) }` gives multiple passes and arbitrary offsets while
staying HTTP-agnostic, so [0002](0002-streams-not-http-objects.md) still holds:
tests pass `bufferBody(...)`, production passes `fileBody(...)`, and neither the
service nor the log knows the difference.

## Reading the command section without reading the pack

`readReceivePackHeader` reads at most 1 MiB from the front of the body, parses
the pkt-lines, and returns `packOffset` and `packSize`. The packfile is never
touched — the log records where it is, not what it contains.

`ContentLength` on the upload is now mandatory: the body is a stream, so the SDK
cannot measure it, and measuring it in memory is precisely what is being
avoided.

## Consequences

- Every push writes its body to `os.tmpdir()` and deletes it when the response
  closes. Disk must fit the largest push.
- The upload is still a **single** `PutObject`. That is within the 5 GiB limit,
  but a stream cannot be rewound, so a mid-flight failure means re-uploading the
  whole entry. Multipart via `@aws-sdk/lib-storage` is the follow-up
  ([0011](0011-deferred.md)); the entry is content-addressed and idempotent, so
  this is a performance problem, not a correctness one.
- `push-transaction.service.spec.ts` streams 2.15 GiB through `commitPush` —
  past `INT_MAX` — in about a second, which is the regression guard.
