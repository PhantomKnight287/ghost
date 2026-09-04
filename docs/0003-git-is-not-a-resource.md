# 0003 — `git/` is not a REST resource

**Status:** adopted

## Decision

The transport lives at `src/git/`, not `src/resources/git/`. Supporting services
live at `src/services/git/*`.

## Why

`resources/` in this codebase means "REST resource: has DTOs, appears in
OpenAPI, returns JSON." Git HTTP is a wire protocol — binary streams, pkt-line
framing, no JSON, `@ApiExcludeController()`. Filing it under `resources/`
invites the next person to give it DTOs and a Swagger entry, and then to
reach for `express.json()`.

## Layout

```
src/git/                              transport edge
  git.controller.ts                   three routes, nothing else
  git.service.ts                      resolve → authorize → delegate
  git.constants.ts                    service names, repo ids
  git.errors.ts

src/services/git/
  protocol/receive-pack-request.ts    pkt-line parsing
  pack-process/                       spawns git upload-pack / receive-pack
  ref-advertisement/                  the info/refs body
  repository-storage/                 materialized bare repos on disk
  wal/                                the log (0004 onward)
```

## Consequences

`bodyParser: false` in `main.ts` is load-bearing and must stay. If it is ever
re-enabled for the REST side, scope it per-route — `express.json()` will consume
the packfile stream before the handler sees it.
