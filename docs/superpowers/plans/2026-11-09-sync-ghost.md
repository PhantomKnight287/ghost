# sync.ghost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan's implementer is the user, by hand, end to end (user decision, 2026-11-09).** Claude reviews; it does not write the code.

**Goal:** A hosted service at `sync.<ghost domain>` where a Ghost user signs in with Ghost, links GitHub, and pairs a Ghost repository with a GitHub repository that then stay in sync both ways without sync.ghost ever destroying anything on its own judgement.

**Architecture:** Two new workspaces under `apps/sync/`. `@ghost/sync-api` (Bun + Hono + better-auth + drizzle on its own Postgres) receives both apps' webhooks, runs one serial queue per sync, and calls idempotent `sync/*` functions that bring one item into agreement across two GitHub-REST clients and one bare git repository. A reconcile timer calls the same functions. `@ghost/sync-web` (TanStack Start) is the four screens and talks only to the API.

**Tech Stack:** Bun, Hono, better-auth (generic OAuth plugin), drizzle-orm + drizzle-kit, Postgres, zod 4, git CLI, TanStack Start, `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-09-sync-ghost-design.md`

## Global Constraints

- Root `package.json` `workspaces` gains `"apps/sync/*"`; `apps/sync` itself has no `package.json`.
- sync.ghost is an outside customer of Ghost: no imports from `apps/api`, `apps/web` or `packages/*`, no access to Ghost's database. That is also why `credentialEnv` is copied from `apps/importer` rather than shared.
- Follow `docs/code-standards.md`: no `to<Format>` reshaping helpers, no concatenated or wrapped strings or comments, comments explain why, every branch tested, no interface with one implementation (a test fake is a second implementation).
- Migrations are generated with `drizzle-kit generate`, never hand-written.
- Tokens never appear in argv, a git remote URL, a log line, an `activity` row or a response to the browser. better-auth stores OAuth tokens encrypted.
- Ghost REST base: `<GHOST_API_URL>/api/v3`. Ghost OAuth: `<GHOST_API_URL>/login/oauth/authorize` and `<GHOST_API_URL>/login/oauth/access_token`. GitHub REST base: `https://api.github.com`.
- Ghost webhook signature: `X-Ghost-Signature-256` = `sha256=` + hex HMAC-SHA256 of `<X-Ghost-Timestamp>.<raw body>`; reject timestamps more than 300 seconds from now. GitHub: `X-Hub-Signature-256` = `sha256=` + hex HMAC-SHA256 of the raw body. Compare in constant time.
- Retries: at most 5 attempts, 30-second timeout per request. Rate limits (429, GitHub's secondary limit, and its primary limit via `x-ratelimit-remaining: 0` until `x-ratelimit-reset`) are retried for every method, honoring `Retry-After` in seconds or as an HTTP date. 5xx and dropped connections are retried only for requests that can be replayed: not a POST, and not a GraphQL mutation, since it may already have taken effect. A wait over 60 seconds fails the request instead of holding the sync's queue; reconcile picks the item up. A non-JSON error page becomes a `RestError` carrying its text.
- Installation token mints share one in-flight request per installation. Git transfers slower than 1 KB/s for 60 seconds are abandoned (`GIT_HTTP_LOW_SPEED_*`), so a stalled host cannot hold a job forever.
- Installation tokens last 1 hour; cache until 5 minutes before `expires_at`.
- `delivery` rows pruned after 7 days, `activity` after 30 days. `RECONCILE_INTERVAL` default `600` seconds. `PORT` default `3005`. `SYNC_DATA_DIR` default `/data`.
- Ghost fork pull request heads live on GitHub at `ghost-pr/<number>`. GitHub fork pull requests are never synced.
- Body marker: `<!-- ghost-sync:from=<side> author=<login> -->` then `**@<login>** on <Ghost|GitHub>:`, a blank line, the original body.
- Check run name for sync health: `Sync with GitHub`.

## Review Focus

1. **A person pushes while sync.ghost is pushing the same ref.** Their commit must survive: the lease fails and the comparison re-runs. Test in Task 8.
2. **An installation token expires mid-backfill** (a large first sync runs past an hour). Every request asks the token source again, so the cache refreshes it. Test in Task 4.
3. **A second reconcile over the same repositories creates nothing.** Interrupted backfills restart from the top and must be idempotent through links. Test in Task 15.
4. **sync.ghost's own writes come back as events** (its push, its copied check run, its comment). None may be copied back. Tests in Tasks 13, 14 and 15.
5. **Ghost ids differ between webhook and REST.** Webhooks carry UUIDs; REST carries numeric ids and a `node_id`. A comment created on Ghost must be found from its webhook UUID. Test in Task 10.

## Contracts fixed by the tests (2026-11-15)

Claude wrote every task's failing tests up front; they live next to the code they test under `apps/sync/api/src/`. Where a test and a task below disagree, the test wins. Test helpers, already written: `lib/fake-rest.ts`, `lib/fake-store.ts`, `lib/fake-git.ts`, `lib/git-fixture.ts`, `lib/test-context.ts`.

- `SyncContext` also carries `git: GitOps` (`fetchBoth`, `fetchPullHead`, `isAncestor`, `pushRef`, exported as a type from `git.ts`) and `appSlug: Record<Side, string>`. `sync/*` call git only through `ctx.git`.
- `SyncRow` fields: `id, ownerId, ghostRepoId, ghostFullName, githubRepoId, githubFullName, ghostInstallationId, githubInstallationId, status, lastError, disconnectReason, lastReconciledAt, createdAt, updatedAt`. Installation ids are `number | null` (a new GitHub repository not yet covered has none). `ghostRepoId` is the Ghost repository's UUID: webhooks send it as `repository.id`, REST as the base64url part of `node_id`. `githubRepoId` is GitHub's numeric id as text.
- `Store` also has `createSync(input): Promise<SyncRow>` (starts `backfilling`), `deleteSync(id)` (with its links, refs and activity), `listActivity(syncId, limit)` (newest first; order by time then insertion), and `listSyncs` takes `ownerId`. `store.ts` exports `ActivityRow`. An activity row's `direction` is the side written to.
- A flagged branch (diverged or rejected) is announced once per state with a comment on both halves of every linked open pull request headed by it, found through Ghost's pull list. `RefFlag.notified` stays false until every comment lands and `RefFlag.posted` records each `<side>#<number>` as it does; a failed notice is logged as `comment` activity, never stops the other refs, and the next run posts only the missing comments.
- `syncIssue` returns `number | null`: null when nothing was copied (source gone, an unlinked pull request, which only `syncPull` creates, or our own unlinked copy). Every create goes through `createOnce` (`sync/write.ts`): after a 5xx or a dropped connection it looks for our copy (newest bot-created issues, or the issue's bot comments, matched by exact title and body) before failing, so a lost answer never yields a duplicate. A 4xx is not looked for.
- A label action may carry `previousName` (GitHub's `changes.name.from` on `label.edited`); the counterpart is then renamed with `new_name` instead of a second label being created. Ghost's `label.edited` event carries only the label id, so a rename made on Ghost reaches GitHub as a new label until Ghost adds the old name to that event.
- `RestError.message` is `"<status> <host message>"`, so activity rows read like `404 Not Found`.
- A copied review's body is `withMarker("<verdict>\n\n<body>", from, author)`, or just the verdict when the body is empty; the marker stays first so echoes are caught. Null `start_line` / `start_side` are left out.
- A linked pull request merged on its source only gets the merge handling (comment and close, or nothing); otherwise title, body and state are patched.
- Handlers return data, not closures: `handleGhost(event, payload)` and `handleGitHub(event, payload)` return `{ kind: "job"; repoId; actor; action: SyncAction }`, `{ kind: "installation"; side; installationId; status? ; added?; removed? }` or `null`. `SyncAction` kinds: `refs`, `pull`, `review`, `review_comment`, `issue`, `comment`, `label`, `check_run`, `sync_check`, `reconcile` (shapes in `handlers.test.ts`). `SyncAction` lives in `sync/action.ts`. `webhookRoutes({ secrets, bots, store, queue })` only stores the action with `queue.push(syncId, action)` before answering 202; the queue's `run(syncId, action)` builds the context and calls `runAction(ctx, action)`, the one dispatcher to `sync/*`.
- An installation event never reconnects a sync disconnected because its owner lost access.
- `startReconcileTimer({ store, queue, intervalSeconds })` returns `{ tick(): Promise<void>; stop(): void }`; a tick queues `{ kind: "reconcile" }` for every `active`, `backfilling` and `error` sync, then prunes. Reconciles run as queued jobs, so they never overlap a webhook job on the same sync; the queue's `onError` logs a failure as activity.
- The queue is a Postgres `job` table (Task 9). `store.enqueueJob` skips a job identical to one still waiting; `claimJob(leaseMs)` takes the oldest job of a sync with nothing older queued or running (`FOR UPDATE SKIP LOCKED`), held by a claim token and a lease the worker renews; `finishJob` deletes it. A failed job is reported and dropped, since reconcile repairs the item.
- Reconcile lists only `/issues?state=all[&since=]` on each side (pull requests come through it with `pull_request` set; GitHub's pull list has no `since`), and copies check runs for open pull request heads only. Default-branch runs come through webhooks.
- Routes: `setupRoutes(deps)` and `syncRoutes(deps)`, `RouteDeps = { store, currentUser, userRest, appInstallation, installUrl, compareRefs, reconcileNow, removeMirror }` (in `routes/setup.ts`). Another user's sync answers 404, never 403. A new GitHub repository the installation does not cover is created, the sync saved `disconnected`, and the response carries the install link; sync.ghost does not add it to the installation itself. `GET /api/github/owners` lists the user and organizations where their membership role is `admin`.

## File structure

```
package.json                         modify: workspaces += "apps/sync/*"
turbo.json                           modify: sync env vars in globalEnv
apps/sync/api/
  package.json  tsconfig.json  drizzle.config.ts  Dockerfile  README.md
  drizzle/                           generated migrations
  src/
    side.ts                          Side, other()
    config.ts         config.test.ts
    format.ts         format.test.ts
    verify.ts         verify.test.ts
    apps.ts           apps.test.ts    JWT + installation tokens
    rest.ts           rest.test.ts    GitHub-style REST client
    db/schema.ts                     drizzle tables
    store.ts          store.test.ts   all reads and writes the engine needs
    git.ts            git.test.ts
    queue.ts          queue.test.ts   durable per-sync jobs (Postgres `job` table)
    sync/action.ts                   SyncAction
    sync/context.ts                  SyncContext
    sync/refs.ts      sync/refs.test.ts
    sync/issues.ts    sync/issues.test.ts      issues + labels
    sync/comments.ts  sync/comments.test.ts
    sync/pulls.ts     sync/pulls.test.ts
    sync/reviews.ts   sync/reviews.test.ts     reviews + review comments
    sync/checks.ts    sync/checks.test.ts
    lib/fake-rest.ts  lib/fake-store.ts        test fakes
    handlers/ghost.ts handlers/github.ts  handlers/handlers.test.ts
    webhooks.ts       webhooks.test.ts         verify → dedupe → enqueue
    reconcile.ts      reconcile.test.ts
    auth.ts
    routes/setup.ts   routes/setup.test.ts     pickers, create sync, preview
    routes/syncs.ts   routes/syncs.test.ts     list, page, pause/resume/resync/delete
    index.ts
apps/sync/web/                       TanStack Start app
```

`apps/sync/db` is folded into `apps/sync/api/src/db` (the spec leaves this to the builder; one workspace fewer, and nothing else reads the schema).

---

### Task 1: Workspace, config, Side

**Files:**
- Modify: `package.json` (workspaces), `turbo.json` (`globalEnv`)
- Create: `apps/sync/api/package.json`, `apps/sync/api/tsconfig.json`, `apps/sync/api/src/side.ts`, `apps/sync/api/src/config.ts`
- Test: `apps/sync/api/src/config.test.ts`

**Interfaces:**
- Produces: `type Side = "ghost" | "github"`, `other(side: Side): Side`, `SIDE_NAME: Record<Side, "Ghost" | "GitHub">`; `loadConfig(env: Record<string, string | undefined>): Config`, `type Config`.

- [x] **Step 1:** `package.json` name `@ghost/sync-api`, `"type": "module"`, scripts `dev`, `start`, `test`, `check-types`, `format`, `db:generate`, `db:migrate` like `apps/importer` and `packages/db`. Deps: `hono`, `zod` (same version as importer), `better-auth`, `drizzle-orm`, `postgres`; dev: `@types/bun`, `drizzle-kit`. `tsconfig.json` copies importer's. Add `"apps/sync/*"` to root workspaces; run `bun install` at the root and confirm `bun pm ls | grep sync-api` lists it.
- [x] **Step 2: Write the failing test** `config.test.ts`:

```ts
const valid = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "s".repeat(32), BETTER_AUTH_URL: "https://sync-api.example.com", SYNC_WEB_URL: "https://sync.example.com", GHOST_API_URL: "https://api.example.com", GHOST_APP_ID: "7", GHOST_APP_SLUG: "ghost-sync", GHOST_APP_PRIVATE_KEY: "pem", GHOST_APP_CLIENT_ID: "c", GHOST_APP_CLIENT_SECRET: "s", GHOST_APP_WEBHOOK_SECRET: "w", GITHUB_APP_ID: "9", GITHUB_APP_SLUG: "ghost-sync", GITHUB_APP_PRIVATE_KEY: "pem", GITHUB_APP_CLIENT_ID: "c", GITHUB_APP_CLIENT_SECRET: "s", GITHUB_APP_WEBHOOK_SECRET: "w" };
test("defaults", () => { const c = loadConfig(valid); expect(c.PORT).toBe(3005); expect(c.RECONCILE_INTERVAL).toBe(600); expect(c.SYNC_DATA_DIR).toBe("/data"); expect(c.GHOST_APP_ID).toBe(7); });
test("private keys accept \\n-escaped PEMs", () => { expect(loadConfig({ ...valid, GHOST_APP_PRIVATE_KEY: "a\\nb" }).GHOST_APP_PRIVATE_KEY).toBe("a\nb"); });
test("missing value names the variable", () => { const { GHOST_API_URL, ...rest } = valid; expect(() => loadConfig(rest)).toThrow(/GHOST_API_URL/); });
```

- [x] **Step 3:** Run `bun test src/config.test.ts` in `apps/sync/api`. Expected: FAIL, `loadConfig` not found.
- [x] **Step 4:** Implement `side.ts` and `config.ts` (zod schema shaped like `apps/importer/src/config.ts`; app ids coerced to int; private keys transformed `\\n` → newline because Railway variables are single-line).
- [x] **Step 5:** Run the test. Expected: PASS. Add every variable from the spec's Configuration table to `turbo.json` `globalEnv`.
- [x] **Step 6:** Commit `feat(sync): sync-api workspace and config`.

### Task 2: Body marker and verdict text

**Files:**
- Create: `apps/sync/api/src/format.ts`
- Test: `apps/sync/api/src/format.test.ts`

**Interfaces:**
- Consumes: `Side`, `SIDE_NAME` (Task 1).
- Produces: `withMarker(body: string, from: Side, author: string): string`; `readMarker(body: string): { body: string; from: Side | null; author: string | null }`; `verdictText(state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED", from: Side, author: string): string`; `mergedText(on: Side): string`.

- [x] **Step 1: Write the failing tests:**

```ts
test("marker and attribution", () => { expect(withMarker("hi", "github", "coderabbitai")).toBe("<!-- ghost-sync:from=github author=coderabbitai -->\n**@coderabbitai** on GitHub:\n\nhi"); });
test("round trip", () => { expect(readMarker(withMarker("hi", "ghost", "gurpal"))).toEqual({ body: "hi", from: "ghost", author: "gurpal" }); });
test("no stacking", () => { const once = withMarker("hi", "github", "a"); expect(withMarker(readMarker(once).body, "github", "a")).toBe(once); });
test("unmarked body", () => { expect(readMarker("plain")).toEqual({ body: "plain", from: null, author: null }); });
test("empty body", () => { expect(readMarker(withMarker("", "ghost", "a")).body).toBe(""); });
test("verdict", () => { expect(verdictText("APPROVED", "github", "x")).toBe("Approved on GitHub by @x"); expect(verdictText("CHANGES_REQUESTED", "ghost", "x")).toBe("Changes requested on Ghost by @x"); });
test("merged", () => { expect(mergedText("ghost")).toBe("Merged on Ghost"); });
```

- [x] **Step 2:** Run `bun test src/format.test.ts`. Expected: FAIL.
- [x] **Step 3:** Implement with one regex anchored at the start of the body; `readMarker` also strips the attribution line and the blank line after it.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): body marker and verdict text`.

### Task 3: Webhook signatures

**Files:**
- Create: `apps/sync/api/src/verify.ts`
- Test: `apps/sync/api/src/verify.test.ts`

**Interfaces:**
- Produces: `verifyGhost(secret: string, rawBody: Uint8Array, timestamp: string | null, signature: string | null, nowSeconds: number): boolean`; `verifyGitHub(secret: string, rawBody: Uint8Array, signature: string | null): boolean`.

- [x] **Step 1: Write the failing tests:** for each side, a body signed in the test with `createHmac` passes; a flipped byte fails; a missing header fails; a signature of different length fails without throwing. Ghost only: `nowSeconds = ts + 301` fails, `ts + 300` passes, `ts - 301` fails.
- [x] **Step 2:** Run `bun test src/verify.test.ts`. Expected: FAIL.
- [x] **Step 3:** Implement with `createHmac` and `timingSafeEqual` (length check first), following `docs/webhooks.md`'s Node example.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): webhook signature checks`.

### Task 4: App JWT and installation tokens

**Files:**
- Create: `apps/sync/api/src/apps.ts`
- Test: `apps/sync/api/src/apps.test.ts`

**Interfaces:**
- Produces: `createAppAuth(opts: { appId: number; privateKey: string; apiUrl: string; fetch: typeof fetch; now: () => number }): AppAuth` where `type AppAuth = { jwt(): string; installationToken(installationId: number): Promise<string> }`. Called once per side in `index.ts`.

- [x] **Step 1: Write the failing tests** (generate an RSA key pair in the test with `generateKeyPairSync`):

```ts
test("jwt claims", () => { /* decode payload: iss === appId, iat === now-60, exp === now+540; header alg RS256; signature verifies with the public key */ });
test("mints at GitHub's path with the jwt", async () => { /* fake fetch sees POST `${apiUrl}/app/installations/42/access_tokens` with Authorization `Bearer <jwt>`; returns { token: "ghs_a", expires_at } */ });
test("reuses a token until 5 minutes before expiry", async () => { /* two calls, one fetch */ });
test("refreshes after that", async () => { /* advance now past expires_at - 300s; second fetch, returns "ghs_b" */ });
test("a refused mint throws with the status", async () => { /* 404 → rejects with /404/ */ });
```

- [x] **Step 2:** Run. Expected: FAIL.
- [x] **Step 3:** Implement. Sign with `node:crypto` `createSign("RSA-SHA256")` over base64url header and payload (no new dependency). `iat` is 60 seconds in the past for clock drift; `exp` 9 minutes after now stays under the 10-minute cap. Cache per installation id in a `Map`.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): app JWT and installation token cache`.

### Task 5: REST client

**Files:**
- Create: `apps/sync/api/src/rest.ts`
- Test: `apps/sync/api/src/rest.test.ts`

**Interfaces:**
- Produces: `createRest(opts: { baseUrl: string; graphqlUrl: string; token: () => Promise<string>; fetch: typeof fetch; sleep: (ms: number) => Promise<void> }): Rest` where `type Rest = { request<T>(method: string, path: string, body?: unknown): Promise<T>; paginate<T>(path: string): AsyncGenerator<T>; graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> }` (GraphQL URL: `<GHOST_API_URL>/api/graphql` on Ghost, `https://api.github.com/graphql` on GitHub, passed as `graphqlUrl` in opts); `class RestError extends Error { status: number; body: unknown }`.

- [x] **Step 1: Write the failing tests:**
  - `token()` is called on every request (Review Focus 2) and sent as `Authorization: Bearer`.
  - 502, 502, 200 → resolves, `sleep` called twice with growing delays.
  - 429 with `Retry-After: 7` → `sleep(7000)`.
  - 403 whose body message contains `secondary rate limit` → retried; plain 403 → `RestError` with status 403, no retry.
  - Five 500s → `RestError` status 500, exactly 5 fetches.
  - `paginate` follows `Link: <...>; rel="next"` across two pages and yields every item; a page shaped `{ total_count, <key>: [] }` (as `/user/installations`) yields the array.
  - 204 → resolves `undefined`.
  - `graphql` POSTs `{ query, variables }` to `graphqlUrl` and returns `data`; a 200 with `errors` throws `RestError` with status 200 and the errors as body.
- [x] **Step 2:** Run. Expected: FAIL.
- [x] **Step 3:** Implement. Backoff `1000 * 2 ** attempt` unless `Retry-After` is set. `Accept: application/vnd.github+json`.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): GitHub-style REST client with retries`.

### Task 6: Schema and store

**Files:**
- Create: `apps/sync/api/drizzle.config.ts`, `apps/sync/api/src/db/schema.ts`, `apps/sync/api/src/store.ts`, `apps/sync/api/src/lib/fake-store.ts`, generated `apps/sync/api/drizzle/*`
- Test: `apps/sync/api/src/store.test.ts` (needs `TEST_DATABASE_URL`, a throwaway Postgres: `docker run --rm -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:17`)

**Interfaces:**
- Produces, in `schema.ts`: tables `installation`, `sync`, `link`, `ref`, `delivery`, `activity` as the spec's Data section lists (better-auth's tables come from `@better-auth/cli generate` in Task 16). `sync.status`: `"backfilling" | "active" | "paused" | "disconnected" | "error"`; `sync.disconnectReason: string | null`. `link.kind`: `"issue" | "pull" | "comment" | "review" | "review_comment" | "label" | "check_run"`. All ids stored as text. `ref` has `(syncId, name)` unique, `baseSha text null`, `diverged jsonb null` (`{ ghost: string | null; github: string | null; reason: string }`).
- Produces, in `store.ts`: `createStore(db): Store` with

```ts
type Store = {
  findLink(syncId: string, kind: LinkKind, side: Side, id: string): Promise<Link | null>;
  saveLink(link: { syncId: string; kind: LinkKind; ghostId: string; ghostRestId: string | null; githubId: string }): Promise<void>;
  deleteLink(syncId: string, kind: LinkKind, side: Side, id: string): Promise<void>;
  getRef(syncId: string, name: string): Promise<RefRow | null>;
  listRefs(syncId: string): Promise<RefRow[]>;
  setBase(syncId: string, name: string, sha: string | null): Promise<void>; // null deletes the row; always clears `diverged`
  flagRef(syncId: string, name: string, diverged: RefFlag): Promise<void>;
  claimDelivery(side: Side, deliveryId: string): Promise<boolean>; // true the first time
  addActivity(entry: { syncId: string; direction: Side | null; kind: string; summary: string; error: string | null }): Promise<void>;
  getSync(id: string): Promise<SyncRow | null>;
  findSyncByRepo(side: Side, repoId: string): Promise<SyncRow | null>;
  listSyncs(filter: { status?: SyncRow["status"][]; installation?: { side: Side; id: number } }): Promise<SyncRow[]>;
  updateSync(id: string, patch: Partial<Pick<SyncRow, "status" | "lastError" | "disconnectReason" | "lastReconciledAt">>): Promise<void>;
  prune(now: Date): Promise<void>;
};
```

  `lib/fake-store.ts` exports `fakeStore(): Store & { links: Link[]; refs: RefRow[]; activity: unknown[] }`, an in-memory implementation for the `sync/*` tests.
- [x] **Step 1: Write the failing tests** (`describe.skipIf(!process.env.TEST_DATABASE_URL)`, migrate before all): `saveLink` then `findLink` by either side's id; saving the same ghost id twice upserts rather than throws; `setBase(null)` removes the row; `setBase` clears a flag; `claimDelivery` true then false; `findSyncByRepo` by GitHub repo id; `prune` removes a 31-day-old activity and 8-day-old delivery and keeps newer ones. Run the same link, ref and delivery assertions against `fakeStore()` so the fake cannot drift.
- [x] **Step 2:** Run `TEST_DATABASE_URL=postgres://postgres:x@localhost:55432/postgres bun test src/store.test.ts`. Expected: FAIL.
- [x] **Step 3:** Write `schema.ts`, run `bun run db:generate`, implement `store.ts` and `fake-store.ts`.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): schema and store`.

### Task 7: Git layer

**Files:**
- Create: `apps/sync/api/src/git.ts`
- Test: `apps/sync/api/src/git.test.ts`

**Interfaces:**
- Produces:

```ts
type Remote = { url: string; token: string | null }; // token null for file:// remotes in tests
type PushResult = { ok: true } | { ok: false; reason: "lease" | "rejected"; message: string };
credentialEnv(origin: string, username: string, password: string): Record<string, string>; // copied from apps/importer/src/git.ts
fetchBoth(dir: string, remotes: Record<Side, Remote>): Promise<Record<Side, Map<string, string>>>; // refname → sha, heads and tags; init --bare on first use
fetchPullHead(dir: string, remote: Remote, number: number): Promise<string>; // refs/pull/<n>/head → sha
isAncestor(dir: string, ancestor: string, descendant: string): Promise<boolean>;
pushRef(dir: string, remote: Remote, ref: string, sha: string | null, expected: string | null): Promise<PushResult>; // sha null deletes; expected null means "must not exist"
```

- [x] **Step 1: Write the failing tests** with two local bare repositories as `file://` remotes and a scratch work tree to make commits:
  - `fetchBoth` maps `refs/heads/main` and `refs/tags/v1` on each side to their shas, into separate namespaces (`refs/sides/ghost/*`, `refs/sides/github/*`) so one side's fetch never overwrites the other's.
  - `isAncestor` true for parent→child, false for siblings.
  - `pushRef` creates, fast-forwards, force-moves and deletes when `expected` matches.
  - `pushRef` returns `{ ok: false, reason: "lease" }` when the remote ref moved away from `expected`, and leaves the remote's commit in place (Review Focus 1).
  - `pushRef` with `expected: null` onto an existing ref returns `reason: "lease"`.
  - A remote `pre-receive` hook that exits 1 → `reason: "rejected"` with the hook's message.
  - With a token, the spawned process gets `GIT_CONFIG_*` env and the token appears in neither argv nor the remote URL (assert on a spy around the spawn helper).
- [x] **Step 2:** Run. Expected: FAIL.
- [x] **Step 3:** Implement. Push uses `--force-with-lease=<ref>:<expected or empty>` and `<sha or empty>:<ref>`; tell lease failures from rejections by git's `stale info` / `rejected` output. Username `x-access-token`.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): git layer with leased pushes`.

### Task 8: Refs, the three-way table

**Files:**
- Create: `apps/sync/api/src/sync/context.ts`, `apps/sync/api/src/sync/refs.ts`, `apps/sync/api/src/lib/fake-rest.ts`
- Test: `apps/sync/api/src/sync/refs.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 6), git functions (Task 7), `Rest` (Task 5).
- Produces, in `context.ts`:

```ts
type SyncContext = {
  sync: SyncRow;
  rest: Record<Side, Rest>;
  repo: Record<Side, { owner: string; name: string }>; // REST paths are `/repos/${owner}/${name}/...`
  remote: () => Promise<Record<Side, Remote>>; // fresh installation tokens each call
  dir: string; // `${SYNC_DATA_DIR}/${sync.id}.git`
  bot: Record<Side, string>; // `${slug}[bot]`
  store: Store;
};
```

  In `refs.ts`:

```ts
type RefState = { base: string | null; ghost: string | null; github: string | null; ghostHasGithub: boolean; githubHasGhost: boolean };
type RefAction =
  | { kind: "none" }
  | { kind: "record"; sha: string | null }
  | { kind: "copy"; to: Side; sha: string | null; expected: string | null }
  | { kind: "diverged" };
decideRef(state: RefState): RefAction;
syncRefs(ctx: SyncContext, only?: string[]): Promise<void>;
```

  `lib/fake-rest.ts` exports `fakeRest(routes: Record<string, unknown | ((body: unknown) => unknown)>): Rest & { calls: { method: string; path: string; body?: unknown }[] }`, keyed `"GET /repos/o/r/issues/1"`; an unknown route throws `RestError` 404.

- [x] **Step 1: Write the failing table test** for `decideRef`, one case per spec row, both directions:

```ts
const cases: [string, RefState, RefAction][] = [
  ["unchanged", { base: "a", ghost: "a", github: "a", ghostHasGithub: true, githubHasGhost: true }, { kind: "none" }],
  ["ghost moved", { base: "a", ghost: "b", github: "a", ghostHasGithub: true, githubHasGhost: false }, { kind: "copy", to: "github", sha: "b", expected: "a" }],
  ["ghost force-pushed", { base: "a", ghost: "x", github: "a", ghostHasGithub: false, githubHasGhost: false }, { kind: "copy", to: "github", sha: "x", expected: "a" }],
  ["ghost deleted", { base: "a", ghost: null, github: "a", ghostHasGithub: false, githubHasGhost: false }, { kind: "copy", to: "github", sha: null, expected: "a" }],
  ["github moved", { base: "a", ghost: "a", github: "b", ghostHasGithub: false, githubHasGhost: true }, { kind: "copy", to: "ghost", sha: "b", expected: "a" }],
  ["both to same", { base: "a", ghost: "b", github: "b", ghostHasGithub: true, githubHasGhost: true }, { kind: "record", sha: "b" }],
  ["both moved, github ahead", { base: "a", ghost: "b", github: "c", ghostHasGithub: false, githubHasGhost: true }, { kind: "copy", to: "ghost", sha: "c", expected: "b" }],
  ["both moved apart", { base: "a", ghost: "b", github: "c", ghostHasGithub: false, githubHasGhost: false }, { kind: "diverged" }],
  ["deleted vs moved", { base: "a", ghost: null, github: "c", ghostHasGithub: false, githubHasGhost: false }, { kind: "diverged" }],
  ["both deleted", { base: "a", ghost: null, github: null, ghostHasGithub: false, githubHasGhost: false }, { kind: "record", sha: null }],
  ["new on ghost", { base: null, ghost: "b", github: null, ghostHasGithub: false, githubHasGhost: false }, { kind: "copy", to: "github", sha: "b", expected: null }],
  ["new on both, same", { base: null, ghost: "b", github: "b", ghostHasGithub: true, githubHasGhost: true }, { kind: "record", sha: "b" }],
  ["new on both, ghost ahead", { base: null, ghost: "c", github: "b", ghostHasGithub: true, githubHasGhost: false }, { kind: "copy", to: "github", sha: "c", expected: "b" }],
  ["new on both, apart", { base: null, ghost: "c", github: "b", ghostHasGithub: false, githubHasGhost: false }, { kind: "diverged" }],
];
test.each(cases)("%s", (_, state, action) => expect(decideRef(state)).toEqual(action));
```

  Add the mirrored GitHub-side rows for "force-pushed", "deleted" and "new" too.
- [x] **Step 2: Write the failing `syncRefs` tests** against two local bare repos (Task 7 style) and `fakeStore()`:
  - New branch on GitHub appears on Ghost and its base is recorded.
  - Diverged branch: neither repo changes, `flagRef` holds both shas, one `activity` row, and one comment on each linked pull request headed by that branch (not repeated while the flag stays).
  - A flag clears once a person pushes a merge to one side (`setBase` called, `diverged` null).
  - Lease failure (a push to the target lands between fetch and push, injected through a wrapped `pushRef`): the person's commit survives and the comparison re-runs once with fresh refs.
  - Rejected push: ref flagged with reason `"rejected: <message>"`, other refs still sync.
  - `ghost-pr/*` refs are skipped here (owned by Task 12).
  - A second `syncRefs` right after the first makes no pushes.
- [x] **Step 3:** Run `bun test src/sync/refs.test.ts`. Expected: FAIL.
- [x] **Step 4:** Implement. `syncRefs` fetches both, takes the union of ref names (plus every stored `ref` row, so deletions are seen), computes `isAncestor` only when both shas exist and differ, applies the action, writes the base only after a push succeeds, and re-runs a ref at most once after a lease failure before flagging it.
- [x] **Step 5:** Run. Expected: PASS.
- [x] **Step 6:** Commit `feat(sync): three-way ref sync`.

### Task 9: Durable queue per sync

**Files:**
- Create: `apps/sync/api/src/queue.ts`, `apps/sync/api/src/sync/action.ts`, `job` table in `src/db/schema.ts`, generated migration
- Modify: `apps/sync/api/src/store.ts`, `apps/sync/api/src/lib/fake-store.ts`
- Test: `apps/sync/api/src/queue.test.ts`, job cases in `apps/sync/api/src/store.test.ts`

**Interfaces:**
- Produces: `type SyncAction` (data, one variant per handler outcome); `Store.enqueueJob(syncId, action)`, `claimJob(leaseMs): Promise<ClaimedJob | null>`, `extendJob(job, leaseMs)`, `finishJob(job)`; `createQueue({ store, run: (syncId, action) => Promise<void>, onError: (syncId: string | null, error) => void, concurrency?, leaseMs?, pollMs? }): { push(syncId, action): Promise<void>; start(): void; stop(): Promise<void>; idle(): Promise<void> }`.

- [x] **Step 1: Write the failing tests:** store (Postgres and fake): jobs of one sync claimed oldest first, one at a time, actions intact; another sync's job claimed meanwhile; an identical waiting job is not queued twice, one behind a running job is; a lapsed lease is reclaimed and the old holder can neither extend nor finish it; `extendJob` keeps a job held; `deleteSync` drops its jobs; six workers claiming at once never take two jobs of one sync (Postgres only). Queue: order without overlap on one sync; two syncs concurrently; at most `concurrency` at once; a throwing job is reported and dropped and the next runs; `idle()` covers jobs queued by jobs; a started queue runs pushed jobs until stopped; jobs left by a previous process run; a job longer than its lease is not run again by another worker; a database failure is reported and the queue recovers.
- [x] **Step 2:** Run. Expected: FAIL.
- [x] **Step 3:** Implement. Claim with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` where no older job of the same sync exists; heartbeat every `leaseMs / 3`; `bun run db:generate`.
- [x] **Step 4:** Run, with `TEST_DATABASE_URL` for the store cases. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): durable per-sync job queue in Postgres`.

### Task 10: Issues, labels and comments

**Files:**
- Create: `apps/sync/api/src/sync/issues.ts`, `apps/sync/api/src/sync/comments.ts`
- Test: `apps/sync/api/src/sync/issues.test.ts`, `apps/sync/api/src/sync/comments.test.ts`

**Interfaces:**
- Consumes: `SyncContext` (Task 8), `withMarker`, `readMarker` (Task 2), `fakeRest`, `fakeStore`.
- Produces:

```ts
ghostKeyOfNodeId(nodeId: string): string; // "IC_<base64url uuid>" → uuid
syncIssue(ctx: SyncContext, from: Side, number: number): Promise<number>; // returns the counterpart's number; used for pull requests' issue fields too
deleteIssue(ctx: SyncContext, from: Side, number: number): Promise<void>;
syncLabelDefinition(ctx: SyncContext, from: Side, name: string): Promise<void>;
deleteLabelDefinition(ctx: SyncContext, from: Side, name: string): Promise<void>;
syncComment(ctx: SyncContext, from: Side, issueNumber: number, commentKey: string): Promise<void>; // key: Ghost uuid or GitHub id
deleteComment(ctx: SyncContext, from: Side, commentKey: string): Promise<void>;
```

- [x] **Step 1: Write the failing tests** (`fakeRest` both sides, `fakeStore`):
  - `syncIssue` unlinked: `POST /repos/<o>/<r>/issues` on the other side with `withMarker(body, from, author)`, title, labels; link saved by number; closed issue created then `PATCH state: closed`.
  - Linked: `PATCH` title, body, state; no `POST`.
  - Source issue authored by the bot: no calls at all.
  - Source body already carries a marker from the other side: the counterpart is updated with the stripped body (an edit made on the side that holds a copy), never re-marked with the bot as author.
  - Labels: a label on the source missing on the other side is created with the same name, color, description before the issue is patched; labels set to exactly the source's names.
  - `deleteIssue` on a linked issue calls the GraphQL `deleteIssue(input: { issueId })` mutation on the other side with the counterpart's `node_id` (fetched with `GET .../issues/<n>`), then removes the link; on an unlinked one, nothing. A refusal (GraphQL error or 403) closes the counterpart with the comment `Deleted on <Ghost|GitHub>` and writes an activity entry.
  - `syncComment` on a Ghost comment from its webhook UUID: lists `GET .../issues/<n>/comments`, finds the one whose `ghostKeyOfNodeId(node_id)` is the UUID, saves `ghostRestId` (Review Focus 5).
  - `syncComment` whose issue has no link syncs the issue first.
  - `deleteComment` uses the stored `ghostRestId` / GitHub id; unlinked is a no-op.
  - A 404 on the parent writes a skipped `activity` row and does not throw.
- [x] **Step 2:** Run. Expected: FAIL.
- [x] **Step 3:** Implement. Read current state from the source with REST, never from a webhook payload.
- [x] **Step 4:** Run. Expected: PASS.
- [x] **Step 5:** Commit `feat(sync): issues, labels and comments`.

### Task 11: Pull requests

**Files:**
- Create: `apps/sync/api/src/sync/pulls.ts`
- Test: `apps/sync/api/src/sync/pulls.test.ts`

**Interfaces:**
- Consumes: `syncRefs`, `fetchPullHead`, `pushRef` (Tasks 7–8), `syncIssue` labels path (Task 10), `mergedText`.
- Produces: `syncPull(ctx: SyncContext, from: Side, number: number): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - Unlinked, same-repository head: `syncRefs(ctx, [head, base])` runs first, then `POST .../pulls` with head, base, title, marked body, `draft`; link saved; labels follow.
  - From GitHub to Ghost works the same way (pull requests from either side).
  - GitHub fork pull request (`head.repo.id !== base.repo.id` on GitHub): no calls, one skipped `activity` row.
  - Ghost fork pull request: `fetchPullHead` then `pushRef` to `refs/heads/ghost-pr/<n>` on GitHub (force, expected = current), GitHub pull request headed `ghost-pr/<n>`; on close, `ghost-pr/<n>` is deleted.
  - Linked: title, body, state and draft follow (`PATCH`; draft via the host's ready-for-review / convert-to-draft call).
  - Merged on one side, counterpart reports `merged: true` after `syncRefs`: nothing more. Counterpart still open: `POST` comment `mergedText(from)` and `PATCH state: closed`.
  - Merged on one side while the base ref is flagged diverged: counterpart stays open, no comment.
  - Head or base missing on the other side after `syncRefs` (diverged first sync): skipped `activity`, no `POST`.
  - Host refuses creation (422 "No commits between"): skipped `activity`, no throw (closed pull requests on first sync).
  - Bot-authored source: no calls.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): pull requests both ways`.

### Task 12: Reviews and review comments

**Files:**
- Create: `apps/sync/api/src/sync/reviews.ts`
- Test: `apps/sync/api/src/sync/reviews.test.ts`

**Interfaces:**
- Consumes: `syncPull` (Task 11), `verdictText`, `withMarker`.
- Produces: `syncReview(ctx: SyncContext, from: Side, pullNumber: number, reviewKey: string): Promise<void>`; `syncReviewComment(ctx: SyncContext, from: Side, pullNumber: number, commentKey: string): Promise<void>`; `deleteReviewComment(ctx: SyncContext, from: Side, commentKey: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - An `APPROVED` review from GitHub becomes `POST .../pulls/<n>/reviews` on Ghost with `event: "COMMENT"` and a body starting with `verdictText("APPROVED", "github", login)`, followed by the marked original body. Same Ghost → GitHub. Never `APPROVE` or `REQUEST_CHANGES`.
  - Review comments in the review are created with the same `path`, `line`, `side`, `start_line`, `start_side`, `commit_id`.
  - A reply (`in_reply_to_id`) maps to the counterpart's root comment id via its link.
  - Edit updates the counterpart body; delete removes it and the link.
  - A comment whose line left the diff (422): skipped `activity`, no throw.
  - Pull request unlinked: `syncPull` runs first.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Ghost review and review comment keys come from the webhook UUID, matched through `ghostKeyOfNodeId` as in Task 10.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): reviews and review comments`.

### Task 13: Check runs and the sync check

**Files:**
- Create: `apps/sync/api/src/sync/checks.ts`
- Test: `apps/sync/api/src/sync/checks.test.ts`

**Interfaces:**
- Produces: `syncCheckRun(ctx: SyncContext, from: Side, checkRunId: string): Promise<void>`; `startSyncCheck(ctx: SyncContext, sha: string): Promise<string>` (Ghost run id); `finishSyncCheck(ctx: SyncContext, runId: string, outcome: { ok: true } | { ok: false; reason: string }): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - A GitHub run on a synced commit is created on Ghost (`POST .../check-runs`) with the same `name`, `head_sha`, `status`, `conclusion`, `output.title`, `output.summary`, and `details_url` = the GitHub run's `html_url`; linked.
  - A second call after GitHub's run completes `PATCH`es the same Ghost run.
  - Ghost → GitHub the same.
  - A run whose `app.slug` is our own app on that side is never copied (Review Focus 4).
  - Commit not on the other side yet: skipped, retried by reconcile.
  - `startSyncCheck` creates `Sync with GitHub`, `in_progress`; `finishSyncCheck` completes `success`, or `failure` with the reason as `output.summary`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): check runs both ways and the sync check`.

### Task 14: Webhook pipeline and handlers

**Files:**
- Create: `apps/sync/api/src/webhooks.ts`, `apps/sync/api/src/handlers/ghost.ts`, `apps/sync/api/src/handlers/github.ts`
- Test: `apps/sync/api/src/webhooks.test.ts`, `apps/sync/api/src/handlers/handlers.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 6, 9, 10–13.
- Produces: `webhookRoutes(deps: { secrets; bots; store: Store; queue: Pick<Queue, "push"> }): Hono`, mounting `POST /webhooks/ghost` and `POST /webhooks/github`. Handlers return data (see Contracts): `handleGhost(event, payload)` and `handleGitHub(event, payload)`; `runAction(ctx, action)` dispatches a `SyncAction` to `sync/*` and is what `index.ts` gives the queue as `run`.

| Ghost event | GitHub event | Job |
| --- | --- | --- |
| `push` | `push`, `create`, `delete` | `syncRefs(ctx, [ref])`; on Ghost also `startSyncCheck` → `finishSyncCheck` |
| `pull_request.*` | `pull_request` | `syncPull` |
| `pull_request.reviewed` | `pull_request_review` | `syncReview` |
| `pull_request.review_commented` | `pull_request_review_comment` | `syncReviewComment` / `deleteReviewComment` |
| `issue.opened/edited/closed/reopened/labeled/unlabeled` | `issues` | `syncIssue` |
| `issue.deleted` | `issues` deleted | `deleteIssue` |
| `issue.commented/comment_edited` | `issue_comment` created/edited | `syncComment` |
| `issue.comment_deleted` | `issue_comment` deleted | `deleteComment` |
| `label.created/edited` | `label` created/edited | `syncLabelDefinition` |
| `label.deleted` | `label` deleted | `deleteLabelDefinition` |
| — | `check_run` | `syncCheckRun` |
| `check_suite.requested` | — | `startSyncCheck` then `syncRefs` then `finishSyncCheck` |
| `check_run.rerequested`, `check_suite.rerequested` | — | full reconcile of the sync (Task 15), then a fresh sync check |
| `installation.*` | `installation`, `installation_repositories` | not a job: update `installation` and set affected syncs `disconnected` / back to `active` with a reconcile |

- [ ] **Step 1: Write the failing pipeline tests** (`app.request` with signed bodies): bad signature → 401; stale Ghost timestamp → 401; repeated delivery id → 200, no job; actor `ghost-sync[bot]` → 200, no job; unknown repository → 200; paused sync → 200, no job; valid event → 202 and one job queued; `installation.deleted` → affected sync `disconnected` with the side named.
- [ ] **Step 2: Write the failing handler tests:** one per table row, asserting the job calls the right function with the right `from`, number and key (spy on the `sync/*` module). Check that Ghost's `repository.id` in a webhook equals `GET /repos/:o/:r` `id`; if it does not, store both on `sync` and match webhooks on the webhook one.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. Read the raw body once with `c.req.arrayBuffer()` before parsing.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit `feat(sync): webhook pipeline and event handlers`.

### Task 15: Reconcile, first sync and lifecycle

**Files:**
- Create: `apps/sync/api/src/reconcile.ts`
- Test: `apps/sync/api/src/reconcile.test.ts`

**Interfaces:**
- Produces: `reconcileSync(ctx: SyncContext, ownerCanAdmin: () => Promise<boolean>): Promise<void>`; `startReconcileTimer(deps: { store: Store; queue: Pick<Queue, "push">; intervalSeconds: number }): { tick(); stop() }` (queues reconciles; see Contracts).

- [ ] **Step 1: Write the failing tests:**
  - Owner no longer admin on either side → `updateSync(status: "disconnected", disconnectReason: "owner lost access")` and nothing else runs.
  - First run (`lastReconciledAt` null): `status: "backfilling"`, then `syncRefs`, then every issue and pull request on both sides, open and closed (`state=all`), each followed by its comments, reviews, review comments and labels; then `status: "active"` and `lastReconciledAt` set.
  - Later run: `since=<lastReconciledAt>` on both list calls.
  - Running the first sync twice over the same fakes makes no second create call (Review Focus 3).
  - Items written by our bot are not copied back (Review Focus 4).
  - A `RestError` 401 → `disconnected` with the side; a 5xx after retries → `activity` error, reconcile continues with the next item.
  - A timer tick queues a reconcile for every `active`, `backfilling` and `error` sync (never `paused` or `disconnected`) and calls `store.prune`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Owner access: `GET /repos/:o/:r` with the owner's user token on each side, `permissions.admin === true`; a missing user or failed refresh counts as lost.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): reconcile, first sync and owner checks`.

### Task 16: Auth

**Files:**
- Create: `apps/sync/api/src/auth.ts`; better-auth tables appended to `src/db/schema.ts` (via `@better-auth/cli generate`), new migration via `bun run db:generate`
- Test: covered by Task 17's route tests through a signed-in test session.

**Interfaces:**
- Produces: `createAuth(db, config): Auth`; `userToken(auth, userId: string, provider: "ghost" | "github"): Promise<string | null>` (refreshes when expired, null when unlinked or refresh fails).

- [ ] **Step 1:** Configure better-auth: `genericOAuth` provider `ghost` with `authorizationUrl` / `tokenUrl` from Global Constraints, `userInfoUrl: <GHOST_API_URL>/api/v3/user`, client id and secret from config; `socialProviders.github` with the GitHub App's client id and secret; `account.accountLinking` on with `trustedProviders: ["ghost", "github"]`; OAuth token encryption on (check the option name in the installed version: `account.encryptOAuthTokens`). Email/password off. GitHub may only be linked, never used to create a user: refuse sign-up through `github` in a `databaseHooks.user.create.before` hook.
- [ ] **Step 2:** Mount at `/api/auth/*` in `index.ts` with CORS for `SYNC_WEB_URL` and credentials.
- [ ] **Step 3:** Manually against dev Ghost: register a dev Ghost App with callback `<sync-api>/api/auth/oauth2/callback/ghost`, sign in, link GitHub, confirm the `account` rows hold encrypted tokens.
- [ ] **Step 4:** Commit `feat(sync): sign in with Ghost, link GitHub`.

### Task 17: Setup and sync routes

**Files:**
- Create: `apps/sync/api/src/routes/setup.ts`, `apps/sync/api/src/routes/syncs.ts`, `apps/sync/api/src/index.ts`
- Test: `apps/sync/api/src/routes/setup.test.ts`, `apps/sync/api/src/routes/syncs.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 15, 16.
- Produces (JSON, session cookie required, 401 otherwise):
  - `GET /api/me` → `{ ghost: { login }, github: { login } | null }`
  - `GET /api/repositories/:side` → repositories covered by the user's installations on that side (`GET /user/installations` then `/user/installations/:id/repositories` with the user token) where `permissions.admin`, each `{ id, fullName, private, synced: boolean }`, plus `installUrl`.
  - `GET /api/github/owners` → the user and organizations they can create repositories in.
  - `POST /api/syncs/preview` `{ ghostRepoId, github: { repoId } }` → `{ branches: { toGhost, toGitHub, diverged }, issues: { toGhost, toGitHub }, pulls: { toGhost, toGitHub } }` (counts; diverged needs a fetch into a temporary bare repo).
  - `POST /api/syncs` `{ ghostRepoId, github: { repoId } | { create: { owner, name, private: boolean } } }` → `{ id }`; queues the first reconcile.
  - `GET /api/syncs`, `GET /api/syncs/:id` (with flagged refs and the last 100 `activity` rows), `POST /api/syncs/:id/pause`, `/resume`, `/resync`, `DELETE /api/syncs/:id`.
- [ ] **Step 1: Write the failing tests** (`fakeRest` for user-token calls, test DB):
  - `POST /api/syncs` refuses (403) when the user is not admin of either repository, or an installation does not cover it; 409 when either repository is already in a sync.
  - Create-new calls `POST /user/repos` (or `/orgs/:org/repos`) with `private` exactly as sent, `auto_init: false`; then, if the installation covers selected repositories only, adds it to the installation (if GitHub refuses with the user token, the response says to add it in the installation settings, and the sync waits in `disconnected` until `installation_repositories.added`).
  - Only the creator may pause, resume, resync or delete (403 otherwise).
  - Delete removes the sync's links, refs, activity and bare repository directory, and makes no REST call to either side.
  - Resume runs a reconcile.
  - No response body contains a token (assert on the serialized JSON for `ghu_`, `ghs_`, `gho_`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `index.ts` wires config, store, both `AppAuth`s, both REST factories, `createQueue({ store, run: (syncId, action) => runAction(contextFor(sync), action), onError })` and `queue.start()`, `webhookRoutes`, these routes (`reconcileNow` = `queue.push(id, { kind: "reconcile" })`), `GET /health`, and `startReconcileTimer`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): setup and sync routes`.

### Task 18: Web

**Files:**
- Create: `apps/sync/web/` (TanStack Start: `package.json` `@ghost/sync-web`, routes `index.tsx` (landing or dashboard), `new.tsx`, `syncs/$id.tsx`)

**Interfaces:**
- Consumes: Task 17's routes and better-auth's client (`createAuthClient` with `genericOAuthClient`).

- [ ] **Step 1:** Landing (signed out): one line on what it does, "Sign in with Ghost" (`signIn.oauth2({ providerId: "ghost" })`).
- [ ] **Step 2:** Dashboard: header with GitHub connection ("Connect GitHub" → `linkSocial({ provider: "github" })`), table of syncs (Ghost repository, GitHub repository, status, last synced), "+ New sync".
- [ ] **Step 3:** New sync (option A, one page): Ghost picker with "Missing one? Install ghost-sync on Ghost"; GitHub "Existing" picker with its install link, or "Create new" with owner, name and Private / Public, Private preselected; already-synced repositories disabled; the preview summary shown once both are picked; "Start sync".
- [ ] **Step 4:** Sync page: health, flagged refs with both commits, last reconcile, recent activity, Resync now, Pause/Resume, Delete (with a confirm that says both repositories are left untouched).
- [ ] **Step 5:** Check every screen in a browser at desktop and phone width against dev Ghost and a scratch GitHub repository.
- [ ] **Step 6:** Commit `feat(sync): web`.

### Task 19: Ship

**Files:**
- Create: `apps/sync/api/Dockerfile`, `apps/sync/api/README.md`, `apps/sync/web/Dockerfile` (or Railway's builder)

- [ ] **Step 1:** API Dockerfile from `apps/importer/Dockerfile` plus `git`, `VOLUME /data`, runs migrations on start.
- [ ] **Step 2:** README: both apps' exact registration settings (the spec's Two apps table, webhook URLs, callback URLs, "Request user authorization during installation" on), environment, protected branches and the bypass note, local dev with a throwaway Postgres.
- [ ] **Step 3:** Register the production Ghost App and GitHub App, create the Railway services, Postgres and volume, set variables, add `sync.<domain>` and the API domain.
- [ ] **Step 4:** End-to-end by hand: pair a scratch Ghost repo with a new private GitHub repo; push on each side; open a PR on each side; install CodeRabbit on the GitHub repo and run `@coderabbitai explain this` from Ghost; force-push on one side; make both sides diverge and see the flag; delete the sync.
- [ ] **Step 5:** Commit `chore(sync): Dockerfile and README`.
