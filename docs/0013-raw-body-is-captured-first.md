# 0013 — The request body is captured before anything else can await

**Status:** adopted — fixes a data-loss bug

## Decision

`GitRawBodyMiddleware` drains the request into `req.gitRawBody` before guards,
pipes, or handlers run. Handlers receive `Readable.from(req.gitRawBody)`, never
the live socket.

## The bug this fixes

`GitService.receivePack` used to materialize the cache before reading the body:

```ts
const repoDirectory = await this.openCache({ username, repo }); // S3 + subprocesses
const body = await readStream(input);                            // too late
```

An unattended request stream loses whatever arrives while the handler is busy.
Git writes its command section in its own socket write, so the chunk dropped
during that await was exactly the ref updates. The body then began at the flush
packet that follows them, and the parser reported *"no ref update commands"* —
an error that describes the symptom perfectly and points nowhere near the cause.

It reproduces only when the await is slow enough, which is why it appeared
against real object storage and never in tests.

## Why middleware rather than reordering

Reordering the two lines fixes today's symptom. It does not fix the shape of the
bug: the moment an async guard exists — and Basic auth for git will be one
([0011](0011-deferred.md)) — the stream is unattended again, during the guard,
before the handler is even called.

Nest middleware runs before guards. Capturing there means no async work can ever
sit between the socket and the first read. The reordering was kept as well;
correct code should not depend on middleware registration for correctness.

## Bonus: content encoding lands here

Git sends `Content-Encoding: gzip` on request bodies at its discretion, and the
stream must be unwrapped before anything parses it — the same position in the
pipeline, for the same reason. `decode()` handles `gzip` and `deflate`, so that
deferred item is closed.

## The general rule

**Never leave an incoming stream unattended across an `await`.** Read it, then
do the slow work. A stream is not a value; it is an event source that is already
running.
