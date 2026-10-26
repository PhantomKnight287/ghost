# Rate limiting across the API and git transports

Issue: #22 on Ghost (migrated from GitHub #67, roadmap item 20). Builds on #115, which made a key over Better Auth's per-key limit answer 429 instead of 401. This plan assumes #115 is merged first.

## Intent

A client is building a Terraform provider for Ghost. It calls both Ghost's own API (`/api/...`) and the GitHub-compatible API (`/api/v3/...`). Every `terraform plan` and `apply` is a burst: one read per resource to refresh state, then the writes. To pace itself and survive the burst, the provider needs honest rate-limit headers on every response, and a 429 it can wait out when it does hit the wall. HashiCorp's `go-retryablehttp`, which most providers use, already waits on `Retry-After` for a 429.

Today it gets neither. Only search, the path list and archives are throttled, in process memory, and their headers do not match GitHub's. Better Auth counts each API key separately (120 a minute) and, before #115, reported a key over its budget as `401 Bad credentials`. Sign-in has only Better Auth's in-memory limiter, which sends a non-standard `X-Retry-After`. Git over HTTP, SSH and all writes have no limits at all.

This work gives Ghost one rate limiter, backed by Redis, that every transport counts against and every HTTP response reports. It also closes the rest of #22: limits on authentication, expensive reads, git and SSH.

## Goals

1. Every HTTP response from `/api/...` and `/api/v3/...`, success or failure, carries GitHub's rate-limit headers for the caller's budget (see "Wire contract"). Exceptions, by design: Better Auth's routes (`/api/auth/*`) outside the `auth` budgets, the health check `GET /api`, and internal routes (`/api/internal/*`), none of which are counted (see "Not counted").
2. A caller over a budget gets `429` with `Retry-After` and the same headers, never a 401 or 403.
3. One budget per signed-in account, shared by Ghost's API, the GitHub-compatible REST API and GraphQL: **120 requests a minute** by default. A session cookie, a personal access token and an OAuth app token of the same account draw from the same pot.
4. Anonymous callers are counted per client IP: **30 a minute** by default.
5. Sign-in, sign-up and password reset have their own, stricter per-IP limits, and a failed sign-in counts against a tighter limit than a successful one.
6. Expensive reads (code search, the path list, source archives, diffs) have a second, smaller budget on top of the main one.
7. Git over HTTP (`info/refs`, `git-upload-pack`, `git-receive-pack`, LFS) is limited per account when a token is sent, else per IP.
8. Git over SSH is limited per account, sharing the `git` budget.
9. Every limit is configurable through an environment variable, documented for self-hosters.
10. Counters live in Redis, so limits hold across any number of API instances. Redis is required.

## Non-goals

- GraphQL cost points. GitHub charges each GraphQL query by its estimated cost; Ghost counts one request per HTTP request. A later issue can add points.
- A `GET /rate_limit` endpoint (GitHub's `/rate_limit`). Add it if a client asks.
- Per-plan or per-account custom limits. Every account gets the same budget.
- A separate budget for writes. Writes count against the main budget only.
- Admin UI for limits.

## Anti-goals

- **A status that lies.** A 401 means the credentials are wrong, a 403 means the caller is not allowed. Throttling is always 429. A Terraform apply that stops halfway on a fake auth failure is the worst outcome for the client.
- **Headers that lie.** `X-RateLimit-Remaining` must be what the next request will actually find. Two counters for the same caller, one of which the headers do not show, break the provider's pacing. Better Auth's per-key counter goes away for this reason (see "Replacing what exists").
- **Locking an account out through one token.** Counting per account means a leaked or runaway token can use the account's budget up. That is accepted (GitHub does the same); revoking the token is the fix.
- **One visitor using up everyone's budget.** Anonymous counting must use the real client IP (`clientIp` in `lib/http/client-ip.ts`), including the IP the web app forwards when it calls the API to render a page, never the web server's own address.
- **A silent fallback.** If Redis is unreachable at boot, the API refuses to start. If Redis drops while running, requests fail closed with a 5xx, not open with no limits. (Builder's call on the exact status; 503 seems right.)

## Wire contract

### Headers on every API response

Names and meanings are GitHub's:

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | The budget's size, e.g. `120` |
| `X-RateLimit-Remaining` | Requests left in the current window, after this one |
| `X-RateLimit-Used` | Requests used in the current window, including this one |
| `X-RateLimit-Reset` | When the window resets, as Unix epoch **seconds** (GitHub's format; `@nestjs/throttler` sends seconds-until-reset by default, which is wrong here) |
| `X-RateLimit-Resource` | Which budget: `core` for the main one, `search` for expensive reads, `auth` for sign-in and friends, `git` for git over HTTP |

When a request draws from more than one budget (an expensive read draws from `core` and `search`), the headers show the budget with the fewest requests remaining.

### Over a budget

- Status `429`.
- `Retry-After`: whole seconds until the window resets, at least `1`.
- The headers above, with `X-RateLimit-Remaining: 0`.
- Body on `/api/v3/...`: `{ "message": "API rate limit exceeded", "documentation_url": "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api" }`, as #115 does.
- Body on Ghost's own routes: the shape `DomainErrorFilter` already produces, message `API rate limit exceeded`.
- GraphQL over budget: HTTP `429` with the headers. The request never reaches Apollo.
- Git over HTTP: `429` with the headers and a short plain-text body; no `WWW-Authenticate`, so git does not prompt for a password.
- A refused request does not count against the budget.

### Window

A fixed one-minute window per caller per budget, started by the caller's first request (builder's call: GitHub's windows behave this way, and Redis `INCR` plus `EXPIRE` is the obvious atomic implementation).

## Budgets and defaults

| Budget | Key | Default | Env var |
|---|---|---|---|
| `core`, signed in | account id | 120/min | `RATE_LIMIT_PER_MINUTE` |
| `core`, anonymous | client IP | 30/min | `RATE_LIMIT_ANONYMOUS_PER_MINUTE` |
| `search` (code search, path list, source archives, diffs: Ghost's `GET pulls/compare`, `GET pulls/compare/patch`, `GET pulls/:number/files`, and GitHub REST's `GET pulls/:number/files` and its `.diff`/`.patch` media types) | account id, else IP | 30/min | `RATE_LIMIT_SEARCH_PER_MINUTE` |
| `auth`, sign-in attempts | client IP | 5/min | `RATE_LIMIT_SIGN_IN_PER_MINUTE` |
| `auth`, failed sign-ins | client IP | 3/min (builder's call on exact number) | `RATE_LIMIT_FAILED_SIGN_IN_PER_MINUTE` |
| `auth`, sign-up and password reset | client IP | 3/min | `RATE_LIMIT_SIGN_UP_PER_MINUTE` |
| `web`, the web app rendering pages | account id, else the forwarded client IP | 300/min signed in, 120/min anonymous (my call on the numbers) | `RATE_LIMIT_WEB_PER_MINUTE`, `RATE_LIMIT_WEB_ANONYMOUS_PER_MINUTE` |
| `git` over HTTP and SSH | account id, else IP | 60/min | `RATE_LIMIT_GIT_PER_MINUTE` |

Plus `REDIS_URL`, required, and `WEB_API_SECRET` (see "The web app").

"Sign-in" covers every Better Auth path that checks a credential: email and password, username, two-factor verification, passkey verification. The builder lists the exact paths. "Password reset" covers the request and the reset itself. Social sign-in callbacks and the device flow are left to `core`.

## Behaviour by transport

### Ghost's API and GitHub REST

A global guard runs after authentication and before the handler. It counts the request against `core` (and `search` on the routes marked as expensive), sets the headers, and throws a `DomainError` subclass when over budget, so `DomainErrorFilter` and `GithubRestFilter` answer in their own shapes. A response that leaves before the guard runs carries no headers. That covers bad-credential 401s from `GithubAuthMiddleware`, which is accepted.

Constraint: on `/api/v3/...` and other `SignInOptional` routes, `ApiKeyAuthGuard` does not set `request.user`, because `GithubAuthMiddleware` resolves the viewer into `request.githubViewer`. The account key must come from whichever is set.

### The web app

The user decided the web app's server-side calls get their own budget, `web`, so browsing Ghost never spends the budget a Terraform run or script depends on. Each page render makes several API calls (about 4–6), so `core`'s 120 a minute would cap a signed-in user near 20 page views a minute.

The web server proves a request is its own with a shared secret header (`WEB_API_SECRET`, set on both `api` and `web`; header name builder's call). A request carrying the right secret is counted against `web`, keyed by the account behind the forwarded cookie, else by the forwarded client IP. A request without it, or with a wrong one, is counted against `core` like any other client. The secret never reaches the browser. Headers report `X-RateLimit-Resource: web`.

### GraphQL

Same budget and headers. The guard must handle Nest's GraphQL execution context (the request and response come from the GraphQL context, not `switchToHttp`). One HTTP request is one count, whatever the query.

### Better Auth routes (sign-in, sign-up, reset)

Limited by the `auth` budgets. They answer `429` with `Retry-After` and the headers, with `X-RateLimit-Resource: auth`. Better Auth's own in-memory limiter is turned off, or pointed at Redis through its `customStorage` if that is simpler. The builder decides, but the response must carry the standard `Retry-After`, not only `X-Retry-After`. A failed sign-in (wrong password, wrong code) also counts against the failed-sign-in budget.

### Git over HTTP

Counted in `GitBasicAuthMiddleware`, after the key is resolved and before the body is spooled. The headers go on the response like the API's. Only `info/refs`, `git-upload-pack`, `git-receive-pack` and the LFS batch call count; individual LFS object downloads and uploads (`info/lfs/objects/:oid`) do not, because a repository with a few hundred LFS objects would otherwise spend minutes in 429s (my call: the batch call already bounds how many transfers a client asks for).

### SSH

Railway's TCP proxy does not pass the client's address, so a per-IP limit would be one limit for everyone. The user decided SSH is counted per account after the key is checked, sharing the `git` budget with git over HTTP. Each git command over SSH (`git-upload-pack`, `git-receive-pack`, `git-lfs-authenticate`) counts once. Over budget, the command fails with a message on stderr saying the rate limit was exceeded and when to retry, and a non-zero exit status. There are no headers to send. There is no limit on SSH connection attempts before authentication.

## Not counted

My calls, to keep the guard where Nest can run it and to keep Ghost's own plumbing out of users' budgets:

- Better Auth's routes other than the `auth` budgets: `get-session`, social sign-in callbacks, the device flow, sign-out. Better Auth runs outside Nest's guard pipeline, and `get-session` runs on every page render.
- The health check `GET /api`.
- Internal routes under `/api/internal/*`, which authenticate with a shared secret, not a user. The importer works through these. Its one git push per import uses the importing user's token and counts against `git` like any push; that is a handful of requests.

## Replacing what exists

- **Better Auth's per-key limit** (`rateLimit` in the `apiKey(...)` plugin in `lib/auth.ts`) is disabled. The account budget replaces it. After that, the `RATE_LIMITED` branch in `lib/api-keys/verify-api-key.ts` from #115 is unreachable. It goes, along with `ApiKeyRateLimitedError`, its filter handling and the guard test for it, unless the builder reuses the error for the new limiter.
- **The repositories module's `ThrottlerModule`** (`resources/repositories/repositories.module.ts`) and its three `@UseGuards(ThrottlerGuard)` uses move to the global limiter, as the `search` budget. `lib/http/rate-limit.ts` becomes the place the tracker and budgets live, or is deleted if the new limiter makes it redundant.
- **The guard's bad-token counter** in `ApiKeyAuthGuard` (20 bad tokens per IP per minute, in a process-local `Map`, marked `ponytail:`) moves to Redis. It keeps its 429, now with `Retry-After` and the headers, `X-RateLimit-Resource: auth`.

## Infrastructure

- `REDIS_URL` is required in the API's config; the app does not boot without it.
- `docker/compose.yaml` gets a `redis` service (official `redis` image, a pinned major), with a healthcheck the `api` service depends on, and `REDIS_URL` in the shared app environment. `WEB_API_SECRET` goes on `api` and `web`, generated by `docker/setup.sh` and `docker/setup.ps1` like the other secrets.
- `apps/api/Dockerfile` changes only if a new workspace package is added.
- `apps/docs/content/docs/self-hosting/configuration.mdx` gets a "Rate limits" section listing every variable above with its default.
- Railway needs a Redis service and `REDIS_URL` on the API before this deploys. That is the user's step, not the builder's.
- The e2e harness (`apps/api/test/harness.ts`) needs a Redis to point at, and the throwaway-backends recipe gains a Redis container.

## Testing

Per the usual workflow, tests come first and must fail before the backend exists. At minimum:

- Headers on a 200 from Ghost's API, the GitHub REST API and GraphQL, with `Remaining` counting down across requests from the same account through two different tokens and a session cookie.
- 429 with `Retry-After` and headers after the budget is spent, on each of the three, in each body shape.
- Anonymous counting by `X-Real-IP` when `RAILWAY_SERVICE_ID` is set; two IPs counted apart.
- `search` budget: an expensive route reports `Resource: search` once it is closer to empty than `core`.
- Sign-in: the attempt limit, the tighter failed-sign-in limit, and `Retry-After` on the 429.
- Git over HTTP: 429 with headers and no `WWW-Authenticate`.
- SSH: a git command over SSH fails with a rate-limit message once the account's `git` budget is spent, and git over HTTP and SSH share that budget.
- Web budget: a request with the right `WEB_API_SECRET` header counts against `web`, not `core`; a wrong or missing secret counts against `core`.
- Env vars change the limits.
- Fail closed: with Redis unreachable, requests do not pass unlimited.

## Left to the builder

- The Redis client library and how the limiter is structured, within the codebase's standards (`docs/code-standards.md`).
- Whether `@nestjs/throttler` with a Redis storage is kept or replaced by a small guard of Ghost's own; either way the header contract above wins over the library's defaults.
- Exact Better Auth paths for each `auth` budget.
