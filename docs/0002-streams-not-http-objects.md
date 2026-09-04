# 0002 — The transport layer takes streams, not `Request`/`Response`

**Status:** adopted

## Decision

`GitService` and everything below it accept `Readable` and return
`{ headers, body }`. Only `GitController` knows `Request` and `Response` exist.

```ts
async receivePack({ username, repo, input }: { input: Readable }): Promise<GitTransportResponse>
```

## Why

Git is a streaming protocol, so a service that cannot stream is useless. But
`req` fuses two things: a byte stream, and an HTTP envelope (params, query,
status, header setters). The service needs the stream. The controller owns
the envelope.

`Readable` is a Node type, not an HTTP type. Express's request *is* a `Readable`,
so the controller passes `req` directly and the type narrows to the stream half.
Nothing inside the service can reach `req.params`.

Headers are **returned as data**, never set. If the service called
`res.setHeader` it would be HTTP-bound again. Returning a plain object means a
test asserts on `headers['Content-Type']` with no server anywhere.

## The ordering bug this fixed

The original `infoRefs` wrote the pkt-line service header to the socket *before*
it knew the spawn would succeed. Because headers are now returned rather than
written, validation and path resolution both complete before anything touches
the socket — which is why the dumb-protocol rejection can be a thrown
`DomainError` at all (see [0005](0005-single-commit-point.md) for the same
principle applied to durability).

## Consequences

- `git.service.spec.ts` runs with no server, no port, and no `git` binary.
- `PackProcessService` can be tested for real against a `git init --bare` tmpdir,
  driven by `Readable.from(buffer)`.
- `@Res()` appears exactly once per handler and does exactly one thing.
