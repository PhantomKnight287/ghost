# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Who does what:** the usual workflow applies. Claude writes each task's tests and runs them red. The user writes the code that turns them green. Claude then audits: tests really green, no test weakened or special-cased, every spec requirement covered.

**Goal:** One Redis-backed rate limiter that every Ghost transport counts against and every API response reports, with GitHub's headers.

**Architecture:**
- **Limiter:** an `@Injectable()` limiter does one atomic Lua call per budget against Redis, giving a fixed one-minute window that starts at the first request. Pure helpers in `lib/rate-limit/` turn its answer into headers and errors.
- **Callers:** a global guard counts Ghost's own routes and GitHub REST, after `ApiKeyAuthGuard`. `GithubAuthMiddleware` counts GraphQL (and, first, all of `/api/v3`), so an over-budget GraphQL request is refused before Apollo. Express middleware counts the Better Auth sign-in routes. `GitBasicAuthMiddleware` and the SSH server count git.

**Tech Stack:** NestJS 11, Express, `ioredis` (new), Better Auth 1.7, ssh2, vitest + supertest e2e.

**Spec:** `docs/superpowers/specs/2026-10-26-rate-limiting-design.md`

**Branch:** `feat/rate-limiting`, cut from `fix/rate-limited-key-429` (#115, Ghost PR #116). Rebase onto `main` once #116 merges.

## Global Constraints

- Header names: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Used`, `X-RateLimit-Reset` (Unix epoch **seconds**), `X-RateLimit-Resource` (`core` | `search` | `auth` | `git` | `web`).
- Over budget: status `429`, `Retry-After` = whole seconds until reset, minimum `1`, and `X-RateLimit-Remaining: 0`. Message `API rate limit exceeded`.
- GitHub body: `{ "message": "API rate limit exceeded", "documentation_url": "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api" }`.
- A refused request does not increment the counter.
- Defaults and env vars (all per minute):
  - `RATE_LIMIT_PER_MINUTE` = 120
  - `RATE_LIMIT_ANONYMOUS_PER_MINUTE` = 30
  - `RATE_LIMIT_SEARCH_PER_MINUTE` = 30
  - `RATE_LIMIT_SIGN_IN_PER_MINUTE` = 5
  - `RATE_LIMIT_FAILED_SIGN_IN_PER_MINUTE` = 3
  - `RATE_LIMIT_SIGN_UP_PER_MINUTE` = 3
  - `RATE_LIMIT_WEB_PER_MINUTE` = 300
  - `RATE_LIMIT_WEB_ANONYMOUS_PER_MINUTE` = 120
  - `RATE_LIMIT_GIT_PER_MINUTE` = 60
- `REDIS_URL` is required. The app does not boot without it or when Redis is unreachable. A Redis failure mid-request answers `503`, never lets the request through.
- `WEB_API_SECRET` is shared by `api` and `web`. The web server sends it as `X-Ghost-Web-Secret`. It never reaches the browser.
- Code standards (`docs/code-standards.md`) apply. Note especially:
  - Pure functions and errors live under `lib/`; `services/` holds only `@Injectable()` classes.
  - No wrapped strings or comments.
  - No one- or two-line helpers.
  - New env vars go in `docker/compose.yaml`, both setup scripts, and `apps/docs/content/docs/self-hosting/configuration.mdx` (rule 11).
- Never run e2e against the dev DB. Use throwaway Postgres, rustfs and Redis containers.

## Review Focus

1. **A token on a `SignInOptional` Ghost route** (public repository reads). `ApiKeyAuthGuard` defers these to Better Auth, which ignores `Authorization: Bearer`. `request.user` is then null, and a Terraform provider would be counted as anonymous at 30 a minute by IP. The limiter must resolve the token's account itself. Test in Task 2.
2. **GraphQL with several top-level fields.** Nest runs guards once per resolver, so one request could count three times. Counting happens once per HTTP request, remembered on the request. Test in Task 2.
3. **The e2e suite itself.** Every suite shares Redis and anonymous `127.0.0.1`, and `gh-cli` sends well over 120 requests a minute. The harness raises every limit unless a test lowers it, and global setup flushes Redis. Done in Task 1, checked by running the whole e2e suite in Task 2.
4. **A key without a TTL in Redis** (a crash between `INCR` and `PEXPIRE`) would lock a caller out forever. The Lua script increments and sets the expiry in one atomic call. Test in Task 1.
5. **A wrong `X-Ghost-Web-Secret` header.** It must count against `core`, not `web`, and it must not be compared in variable time. Test in Task 3.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/src/lib/rate-limit/budgets.ts` | Budget type, reading limits from config |
| `apps/api/src/lib/rate-limit/headers.ts` | Decision to headers |
| `apps/api/src/lib/rate-limit/rate-limit.errors.ts` | `RateLimitedError` (429), `RateLimiterUnavailableError` (503); replaces #115's `lib/api-keys/api-keys.errors.ts` |
| `apps/api/src/lib/rate-limit/request-identity.ts` | Which account or IP a request is counted as, and whether it is the web app |
| `apps/api/src/lib/http/secrets-match.ts` | Constant-time secret comparison, shared with `ImporterSecretGuard` |
| `apps/api/src/services/rate-limit/rate-limiter.service.ts` | Redis client use, the Lua consume |
| `apps/api/src/rate-limit/rate-limit.module.ts` | Global module: Redis client provider, limiter, guard |
| `apps/api/src/rate-limit/rate-limit.guard.ts` | Global guard and the `@ExpensiveRead()` / `@NotRateLimited()` decorators |
| `apps/api/src/rate-limit/auth-rate-limit.middleware.ts` | Better Auth sign-in, sign-up and reset budgets |
| Deleted | `lib/http/rate-limit.ts` (+ spec), `lib/api-keys/api-keys.errors.ts`, `ThrottlerModule` in `repositories.module.ts`, `@nestjs/throttler` dependency |

---

### Task 1: Redis limiter core and infrastructure

**Issue slice:** "Rate limiting 1/4: Redis-backed limiter and core budget"

**Files:**
- Create: `lib/rate-limit/budgets.ts`, `lib/rate-limit/headers.ts`, `lib/rate-limit/rate-limit.errors.ts`, `services/rate-limit/rate-limiter.service.ts`, `rate-limit/rate-limit.module.ts`
- Modify: `apps/api/package.json` (add `ioredis`), `app.module.ts` (import `RateLimitModule`), `test/harness.ts`, `test/global-setup.ts`, `.github/workflows/api.yml` (redis service + `TEST_REDIS_URL`), `docker/compose.yaml`, `docker/setup.sh`, `docker/setup.ps1`, `apps/docs/content/docs/self-hosting/configuration.mdx`
- Test: `services/rate-limit/rate-limiter.service.spec.ts` (runs against `TEST_REDIS_URL`, skipped without it), `lib/rate-limit/headers.spec.ts`

**Interfaces (produces):**
```ts
// lib/rate-limit/budgets.ts
export type RateLimitResource = 'core' | 'search' | 'auth' | 'git' | 'web';
export type Budget = { name: string; resource: RateLimitResource; limit: number };
export type Budgets = Record<'core' | 'coreAnonymous' | 'search' | 'signIn' | 'failedSignIn' | 'signUp' | 'web' | 'webAnonymous' | 'git' | 'badToken', Budget>;
export function rateLimitBudgets(config: ConfigService): Budgets; // badToken: 20/min, resource 'auth', not configurable (as today)

// lib/rate-limit/headers.ts
export type RateLimitDecision = { budget: Budget; used: number; remaining: number; resetAt: number /* epoch s */; retryAfter: number /* s, >= 1 */; allowed: boolean };
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string>; // adds Retry-After only when !allowed
export function tightest(decisions: RateLimitDecision[]): RateLimitDecision; // refused first, else fewest remaining

// lib/rate-limit/rate-limit.errors.ts
export class RateLimitedError extends DomainError { status = 429; readonly headers: Record<string, string>; constructor(decision: RateLimitDecision) }
export class RateLimiterUnavailableError extends DomainError { status = 503 }
export const GITHUB_RATE_LIMIT_DOCUMENTATION_URL = 'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api';

// services/rate-limit/rate-limiter.service.ts
export const REDIS = Symbol('REDIS');
@Injectable() export class RateLimiterService {
  consume(budget: Budget, key: string): Promise<RateLimitDecision>; // counts unless already over
  peek(budget: Budget, key: string): Promise<RateLimitDecision>;    // never counts
}
```

- [ ] **Step 1 (Claude): Write the failing tests**

`rate-limiter.service.spec.ts`. Each test uses a fresh random key.
- `counts down and reports the window`: 3 consumes on a limit-3 budget give `used` 1, 2, 3, `remaining` 2, 1, 0, all `allowed`. `resetAt` is within `[now, now + 60]`.
- `refuses past the limit without counting`: the 4th consume is `allowed: false` with `used: 3`. A following `peek` still shows `used: 3`.
- `starts a fresh window when the old one expires`: a 1-second window budget, used up, then after 1.1 s `allowed` again with `used: 1`. (The service takes the window from a constructor-injected `windowMs`, default `60_000`, so the test can shorten it.)
- `never leaves a counter without an expiry`: after one consume, `PTTL` on the key is `> 0`.
- `peek does not count`: `peek` twice leaves `used: 0`.
- `fails closed`: a service on a client pointed at a closed port rejects `consume` with `RateLimiterUnavailableError`.

`headers.spec.ts`:
- An allowed decision `{ limit 120, used 5, remaining 115, resetAt 1761480000 }` gives exactly `X-RateLimit-Limit: '120'`, `X-RateLimit-Remaining: '115'`, `X-RateLimit-Used: '5'`, `X-RateLimit-Reset: '1761480000'`, `X-RateLimit-Resource: 'core'`, and no `Retry-After`.
- A refused one adds `Retry-After` equal to `String(retryAfter)`.
- `tightest` prefers a refused decision, else the lowest `remaining`.

- [ ] **Step 2 (Claude): Run red**

Run: `TEST_REDIS_URL=redis://localhost:56379 npx vitest run src/services/rate-limit src/lib/rate-limit`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3 (user): Implement**

- Key layout: `ratelimit:{budget.name}:{key}`.
- Consume is a single `EVAL` of this script (`KEYS[1]` = key, `ARGV` = limit, windowMs, count 1/0), returning `{used, pttl, allowed}`:
  ```lua
  local used = tonumber(redis.call('GET', KEYS[1]) or '0')
  if used >= tonumber(ARGV[1]) then return {used, redis.call('PTTL', KEYS[1]), 0} end
  if ARGV[3] == '1' then
    used = redis.call('INCR', KEYS[1])
    if used == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
  end
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = tonumber(ARGV[2]) end
  return {used, ttl, 1}
  ```
- `RateLimitModule` is `@Global()`. Its `REDIS` provider reads `config.getOrThrow('REDIS_URL')` and builds `new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 })`, then awaits `connect()`, so boot fails when Redis is unreachable. It closes the client on module destroy.
- Any Redis error becomes `RateLimiterUnavailableError`.
- Infrastructure:
  - **compose:** a `redis:8-alpine` service with healthcheck `redis-cli ping`. `api` depends on it being healthy, and `REDIS_URL: redis://redis:6379` goes in `&app-env`.
  - **CI:** a `redis:8-alpine` service on the `api` job, with `TEST_REDIS_URL`.
  - **harness:**
    - `REDIS_URL` comes from `TEST_REDIS_URL`, and `hasBackends` requires it.
    - `startApp` defaults every `RATE_LIMIT_*` to `'100000'`; `env` overrides win.
    - Global setup runs `FLUSHDB`.
  - **docs:** add a "Rate limits" section to `configuration.mdx` with `REDIS_URL` and the table of env vars and defaults from the spec.

- [ ] **Step 4 (Claude): Run green and audit**

Run the Step 2 command. Expected: PASS. Then audit the diff for weakened tests.

- [ ] **Step 5: Commit**

`git commit -m "Count requests in Redis, one atomic window per budget"`

---

### Task 2: Core and search budgets on Ghost's API, GitHub REST and GraphQL

**Issue slice:** same as Task 1 (1/4). After this task the provider gets honest headers.

**Files:**
- Create: `rate-limit/rate-limit.guard.ts`, `lib/rate-limit/request-identity.ts`
- Modify:
  - `app.module.ts`: register `RateLimitGuard` as `APP_GUARD` directly after `ApiKeyAuthGuard`.
  - `github/auth/github-auth.middleware.ts`: count `core` after resolving the viewer, store the decision on the request, and write the GitHub 429 itself.
  - `github/rest/github-rest.filter.ts`: for `RateLimitedError`, set `exception.headers` and use `GITHUB_RATE_LIMIT_DOCUMENTATION_URL`.
  - `filters/domain-error/domain-error.filter.ts`: switch `instanceof` to `RateLimitedError`.
  - `lib/auth.ts`: set `rateLimit: { enabled: false }` at the top level and in `apiKey(...)`.
  - `lib/api-keys/verify-api-key.ts`: drop the `RATE_LIMITED` branch and `API_KEY_REQUESTS_PER_MINUTE`.
  - `auth/api-key-auth.guard.ts`: no change beyond the import.
  - `repositories.module.ts`: remove `ThrottlerModule`.
  - `repositories.controller.ts` (3 handlers), `search.controller.ts`, and both `pulls/:number/files` plus `compare`/`compare/patch` handlers: `@UseGuards(ThrottlerGuard)` becomes `@ExpensiveRead()`.
  - `app.controller.ts` `GET /api` and `importer-callbacks.controller.ts` (class): `@NotRateLimited()`.
  - `lib/openapi.ts`: one sentence on the token scheme naming the 120/min budget and the headers.
- Delete: `lib/http/rate-limit.ts` and its spec, `lib/api-keys/api-keys.errors.ts`, the #115 guard unit test for `RATE_LIMITED`, `test/api-key-rate-limit.e2e-spec.ts` (superseded).
- Test: `test/rate-limit.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1's `RateLimiterService`, `rateLimitBudgets`, `rateLimitHeaders`, `tightest`, `RateLimitedError`.
- Produces:
```ts
// lib/rate-limit/request-identity.ts
export type RateLimitIdentity = { kind: 'account'; id: string } | { kind: 'ip'; ip: string };
export function rateLimitIdentity(request: Request & { user?: { id: string } | null; githubViewer?: { userId: string } | null }, onRailway?: boolean): RateLimitIdentity | null;
// null = has a token but no resolved account yet; the guard then verifies it with verifyApiKey(auth.api, key) and counts by its referenceId (bad token: by IP)

// rate-limit/rate-limit.guard.ts
export const ExpensiveRead: () => MethodDecorator;   // also counts `search`
export const NotRateLimited: () => ClassDecorator & MethodDecorator;
// request.rateLimit?: RateLimitDecision, the main budget's decision, set once per HTTP request by whoever counts first
```

- [ ] **Step 1 (Claude): Write the failing e2e tests** in `test/rate-limit.e2e-spec.ts`

The app starts with `RATE_LIMIT_PER_MINUTE: '5'`, `RATE_LIMIT_ANONYMOUS_PER_MINUTE: '3'` and `RATE_LIMIT_SEARCH_PER_MINUTE: '2'`. One account signs up with a session cookie and two PATs.
- `reports the core budget on a 200 from Ghost's API`: `GET /api/notifications` with PAT 1 gives `x-ratelimit-limit` `'5'`, `remaining` `'4'`, `used` `'1'`, `resource` `'core'`, and `reset` within 61 s of now as epoch seconds.
- `shares one budget across tokens, the session and both APIs`: PAT 1 on `/api/notifications`, PAT 2 on `/api/v3/user`, then the cookie on `/api/notifications` give `remaining` `4`, `3`, `2`, in order, across one fresh account.
- `counts a token on a sign-in-optional route by its account, not its IP`: on `GET /api/repositories/{owner}/{repo}` (public repo) with a PAT, `x-ratelimit-limit` is `'5'`, not `'3'`.
- `refuses Ghost's API over budget with Retry-After`: the 6th request is `429` with `retry-after` between `1` and `60`, `remaining` `'0'`, and `body.message` `'API rate limit exceeded'`.
- `refuses GitHub REST over budget in GitHub's shape`: the body equals the Global Constraints GitHub body, and the headers are present.
- `refuses GraphQL over budget with HTTP 429, not a GraphQL error`: `POST /api/graphql { viewer { login } }` over budget gives status `429` with headers. Under budget, a query with two top-level fields (`viewer { login }` and `rateLimitProbe: viewer { id }`) uses exactly one count.
- `counts anonymous callers per IP`: `GET /api/v3/users/{login}` without a token gives `limit` `'3'`.
- `does not count a refused request`: after two 429s, the Redis key `ratelimit:core:{userId}` (read with a test `ioredis` client) holds `'5'`, not `'7'`.
- `reports the tighter search budget on expensive reads`: `GET /api/v3/repos/{o}/{r}/pulls/1/files` twice gives `resource` `'search'` with `remaining` `'0'` on the second, and the third is a `429` with `resource` `'search'`.
- `leaves health checks and internal routes uncounted`: `GET /api` 20 times all give 200 with no `x-ratelimit-limit` header.
- `wrong token is still 401 Bad credentials` (carried over from #115).

- [ ] **Step 2 (Claude): Run red**

Run: `TEST_DATABASE_URL=… TEST_S3_ENDPOINT=… TEST_REDIS_URL=… npx vitest run --config ./vitest.config.e2e.ts test/rate-limit.e2e-spec.ts`
Expected: FAIL on the missing headers.

- [ ] **Step 3 (user): Implement** the guard, the identity function and the middleware counting described above.

- The guard skips non-HTTP contexts; GraphQL is counted in the middleware.
- It skips `@NotRateLimited()` routes.
- It reuses `request.rateLimit` when it is already set.
- It counts the `search` budget on top for `@ExpensiveRead()` routes.
- It sets `rateLimitHeaders(tightest(...))` on the response.
- It throws `RateLimitedError(tightest(...))` when any budget refuses.

- [ ] **Step 4 (Claude): Run green, then the whole e2e suite**

Expected: `rate-limit.e2e-spec.ts` passes, and the full suite shows no failures beyond the two known ones (`storage-limits`, `webhook-events`). Audit.

- [ ] **Step 5: Commit**

`git commit -m "Report and enforce one per-account budget across both APIs"`

---

### Task 3: Web app budget

**Issue slice:** "Rate limiting 2/4: separate budget for the web app"

**Files:**
- Create: `lib/http/secrets-match.ts`
- Modify:
  - `lib/rate-limit/request-identity.ts`: add the web flag.
  - `rate-limit.guard.ts` and `github-auth.middleware.ts`: pick the `web` or `webAnonymous` budget.
  - `resources/imports/importer-secret.guard.ts`: use `secretsMatch`.
  - `apps/web/src/lib/api/server.ts` (`forwardedHeaders` adds `x-ghost-web-secret`).
  - `apps/web/src/lib/env.ts`: add `WEB_API_SECRET`, server-only, without `NEXT_PUBLIC_`.
  - `docker/compose.yaml`: `WEB_API_SECRET` on `api` and `web`.
  - `docker/setup.sh` and `docker/setup.ps1`: generate it with `hex 32`.
  - `configuration.mdx`.
- Test: `test/rate-limit.e2e-spec.ts` (new describe block), `lib/http/secrets-match.spec.ts`

**Interfaces:**
```ts
export function secretsMatch(given: string | undefined, expected: string | undefined): boolean; // false when either is empty; sha256 both, timingSafeEqual
export function isWebApp(request: Pick<Request, 'headers'>, secret: string | undefined): boolean;
```

- [ ] **Step 1 (Claude): Write the failing tests**

The app runs with `WEB_API_SECRET: 'web-secret'`, `RATE_LIMIT_WEB_PER_MINUTE: '7'` and `RATE_LIMIT_PER_MINUTE: '5'`.
- `counts the web app against its own budget`: a cookie request with `x-ghost-web-secret: web-secret` reports `limit` `'7'` and `resource` `'web'`. A following request with the same cookie and no header reports `limit` `'5'` and `remaining` `'4'`, so `core` was untouched.
- `counts a wrong secret against core`: header `wrong` gives `resource` `'core'`.
- `counts anonymous web traffic by the forwarded IP` (with `RAILWAY_SERVICE_ID` set): two `x-real-ip` values each start at `used: 1`.
- `secretsMatch` unit tests: equal gives true; different, different lengths, and empty or undefined on either side give false.

- [ ] **Step 2 (Claude): Run red.** Expected: FAIL. The `web` resource does not exist yet.
- [ ] **Step 3 (user): Implement.**
- [ ] **Step 4 (Claude): Run green, audit.** Then load a repository page in the web app locally and confirm the API logs show `resource: web`.
- [ ] **Step 5: Commit** `git commit -m "Give the web app its own budget, proved by a shared secret"`

---

### Task 4: Sign-in, sign-up and reset budgets; bad tokens in Redis

**Issue slice:** "Rate limiting 3/4: authentication budgets"

**Files:**
- Create: `rate-limit/auth-rate-limit.middleware.ts`
- Modify:
  - `rate-limit.module.ts`: apply the middleware to the paths below, ahead of Better Auth's handler. If Nest middleware cannot run ahead of `@thallesp/nestjs-better-auth`'s mount, register it in `app.setup.ts` before the auth module mounts instead.
  - `auth/api-key-auth.guard.ts`: replace the `failures` `Map`, `fail()` and the sweep with `RateLimiterService` on the `badToken` budget. `peek` before verifying, `consume` on a bad token. Throw `RateLimitedError` (headers, `resource: auth`). Delete the `ponytail:` comment.
  - `lib/openapi.ts`: keep the "Twenty bad tokens" sentence true.
  - `configuration.mdx`.
- Test: `test/auth-rate-limit.e2e-spec.ts`, `auth/api-key-auth.guard.spec.ts` (the fake limiter replaces the `Map`-based tests)

**Paths** (under `/api/auth`):
- `signIn`: `/sign-in/email`, `/sign-in/username`, `/two-factor/verify-totp`, `/two-factor/verify-otp`, `/two-factor/verify-backup-code`, `/passkey/verify-authentication`.
- `signUp`: `/sign-up/email`, `/request-password-reset`, `/forget-password`, `/reset-password`, `/send-verification-email`. The last one is the plan's call: it sends mail like the rest, and Better Auth's limiter that guarded it is now off.

**Behaviour:**
- **Sign-in paths:** `peek` the `failedSignIn` budget first. If it is spent, refuse. Otherwise `consume` `signIn`. On `res.on('finish')` with a status of 400–499 other than 429, `consume` `failedSignIn`.
- **Sign-up paths:** `consume` `signUp`.
- **Key:** always the client IP (`clientIp`).
- **Responses:** headers on every response from these paths. A 429 sends JSON `{ message: 'API rate limit exceeded' }`.

- [ ] **Step 1 (Claude): Write the failing tests**

The app runs with `RATE_LIMIT_SIGN_IN_PER_MINUTE: '4'`, `RATE_LIMIT_FAILED_SIGN_IN_PER_MINUTE: '2'` and `RATE_LIMIT_SIGN_UP_PER_MINUTE: '2'`. Each test sends its own `x-real-ip` with `RAILWAY_SERVICE_ID` set.
- `limits sign-in attempts per IP`: 4 correct sign-ins get 200, and the 5th gets 429 with `retry-after`, `x-ratelimit-resource` `'auth'` and `remaining` `'0'`.
- `limits failed sign-ins more tightly`: 2 wrong passwords get 401, then the 3rd attempt, even with the right password, gets 429.
- `limits sign-up and password reset per IP`: 2 sign-ups pass, and the 3rd is 429. The reset request on the same IP is also 429, because the budget is shared.
- `counts IPs apart`: a second `x-real-ip` signs in fine after the first is blocked.
- `leaves get-session uncounted`: 20 `GET /api/auth/get-session` calls are all 200.
- `still throttles an address after 20 bad tokens, now with Retry-After` (guard). The guard unit tests use a fake `RateLimiterService`.

- [ ] **Step 2 (Claude): Run red.**
- [ ] **Step 3 (user): Implement.**
- [ ] **Step 4 (Claude): Run green, audit.**
- [ ] **Step 5: Commit** `git commit -m "Limit sign-in, sign-up and bad tokens per address in Redis"`

---

### Task 5: Git over HTTP and SSH

**Issue slice:** "Rate limiting 4/4: git over HTTP and SSH"

**Files:**
- Modify:
  - `git/middleware/git-basic-auth/git-basic-auth.middleware.ts`: after `resolveKey`, skip `info/lfs/objects/` paths. Otherwise `consume` the `git` budget by `actor.userId`, else by `clientIp`. Set the headers. Over budget, send `429` with `Content-Type: text/plain` and body `API rate limit exceeded; try again in {n} seconds\n`, with no `WWW-Authenticate`.
  - `services/git/ssh/ssh-server.service.ts`: in `exec`, after parsing and before `authorize`, when `actor` is set, `consume` `git` by `actor.userId`. Over budget, write `ghost: API rate limit exceeded; try again in {n} seconds\n` to stderr and `end(channel, 1)`. Anonymous SSH is not counted, because Railway hides client IPs.
  - `configuration.mdx`.
- Test: `test/git-rate-limit.e2e-spec.ts`

- [ ] **Step 1 (Claude): Write the failing tests**

The app runs with `RATE_LIMIT_GIT_PER_MINUTE: '3'`, SSH on (host key and port as in `lfs.e2e-spec.ts`), and one account with a PAT and an SSH key.
- `limits git over HTTP per account`: 3 `info/refs` with the PAT get 200 with `x-ratelimit-resource` `'git'`. The 4th gets 429 with `retry-after`, a text body, and no `www-authenticate`.
- `does not count LFS object transfers`: after the budget is spent, `GET info/lfs/objects/{oid}` is not a 429.
- `shares the git budget with SSH`: spend 2 over HTTP. Then `git ls-remote` over SSH succeeds once, and a second `git ls-remote` over SSH fails with stderr containing `API rate limit exceeded`.
- `counts anonymous HTTP clones by IP`: no auth on a public repo still gets `x-ratelimit-limit` `'3'`.
- `does not touch the API budget`: after git requests, `/api/notifications` reports `used` `'1'`.

- [ ] **Step 2 (Claude): Run red.**
- [ ] **Step 3 (user): Implement.**
- [ ] **Step 4 (Claude): Run green, then the full e2e suite** (`lfs`, `gh-cli`, `push-validation` must stay green), audit.
- [ ] **Step 5: Commit** `git commit -m "Limit git over HTTP and SSH per account"`

---

## Before merge

- [ ] Railway: add a Redis service and set `REDIS_URL` and `WEB_API_SECRET` on `api` and `web`. The user does this.
- [ ] Remove `@nestjs/throttler` from `apps/api/package.json` if nothing imports it (`grep -r nestjs/throttler apps/api/src`).
- [ ] Push to both remotes and open a PR on each. The Ghost PR closes #22 and the four slice issues.
