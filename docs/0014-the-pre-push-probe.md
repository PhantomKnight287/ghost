# 0014 — A flush-only POST is a probe, not a malformed push

**Status:** adopted — fixes a bug that only appears above 1 MiB

## Decision

`GitService.receivePack` answers a request whose entire body is a single flush
packet (`0000`) with `200` and an empty body. It does not parse it, touch the
log, or run `receive-pack`.

## Why git sends it

A push larger than `http.postBuffer` (default 1 MiB) cannot be buffered, so git
sends it with `Transfer-Encoding: chunked`. A chunked request cannot be rewound,
which means git cannot replay it after a `401` to add credentials.

So `probe_rpc()` in git's `remote-curl.c` fires a throwaway POST first — body
exactly `0000`, `Content-Length: 4` — checks the status, handles any auth
challenge there, and only then streams the real request.

Captured from a real push:

```
POST #1  bytes=4        content-length=4            head="0000"
POST #2  bytes=2428943  transfer-encoding=chunked   head="00b600000000"
```

## The symptom

Answering the probe with `400` kills the push before the real body is sent:

```
error: RPC failed; HTTP 400 curl 22 The requested URL returned error: 400
send-pack: unexpected disconnect while reading sideband packet
fatal: the remote end hung up unexpectedly
```

The server-side error was `no ref update commands`, which is accurate — the
probe genuinely has none — and points nowhere near the cause.

It reproduces **only above `http.postBuffer`**. Pushes of 95 KB and 178 KB use
`Content-Length` and never probe, so the whole test suite and two rounds of
manual probing missed it. Any repository of real size hits it every time.

## Consequence for authentication

The probe is where git expects to be challenged. When the Basic auth guard lands
([0011](0011-deferred.md)), it must run on the probe and return `401` with
`WWW-Authenticate: Basic realm="Ghost"` — that is the whole reason the probe
exists. Skipping auth for flush-only bodies would defeat it, so the probe
short-circuit sits *after* guards, inside the handler, not in middleware.

## Note on `upload-pack`

`probe_rpc` is not push-specific; a fetch with a very large want/have list would
probe too. That path needs no special case: `git upload-pack --stateless-rpc`
given a lone flush packet exits cleanly with empty output, which is already a
valid `200`.
