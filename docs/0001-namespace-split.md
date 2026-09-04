# 0001 — Git lives at the root namespace, REST lives under `/api`

**Status:** adopted

## Decision

`app.setGlobalPrefix('/api')` with `:username/*path` excluded. Every REST route is
served from `/api/*`; the root namespace belongs to the git transport.

## Why

`/:username/:repo/info/refs` is a greedy root-level route. Registered alongside
`/repositories`, it competes with every present and future REST path, and Nest
resolves the conflict by module registration order in `AppModule.imports`. That
is invisible in code review and breaks the moment someone reorders an import.

GitHub draws the same line: `api.github.com` for REST, `github.com/user/repo.git`
for the transport. Better Auth already sits at `/api/auth`, so half the split
existed anyway.

## Alternatives rejected

- **Serve git under a prefix** (`/git/:username/:repo`). Works, but `git clone`
  URLs then carry a `/git` segment forever. The clone URL is user-facing product
  surface; it should read `host/user/repo.git`.
- **Order routes carefully.** Correct today, fragile permanently.

## Consequences

- `NEXT_PUBLIC_API_URL` consumers in `fetch-client.ts` target `/api`.
- `openapi.json` must be regenerated when the prefix changes.
- Any future root-level page route (`/settings`, `/explore`) is served by the web
  app, not the API — the API's root namespace is reserved for git.
