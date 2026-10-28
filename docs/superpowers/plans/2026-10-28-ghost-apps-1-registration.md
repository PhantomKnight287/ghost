# Ghost Apps 1: Registration and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Who does what:** the usual workflow applies. Claude writes each task's tests and runs them red. The user writes the code that turns them green. Claude then audits: tests really green, no test weakened or special-cased, every spec requirement covered. Task 5 (web UI and docs) is Claude's, after the audit.

**Goal:** Any user or org admin can register a Ghost App with permissions, events and private keys, and Octokit's `App` class authenticates as it and reads `GET /app`.

**Architecture:**
- **Data:** an `app` table (integer App ID, immutable slug, soft delete), an `app_public_key` table (the verifying half of each private key the owner generated; the API and UI still say "private key", as GitHub does), and a bot `user` row per app (`kind = 'bot'`, username `slug[bot]`) that can never hold a session or an API key.
- **Management:** cookie-only Ghost API under `/api/apps` (and `/api/organizations/:slug/apps`), shaped like `resources/oauth-apps/`. A public read at `GET /api/apps/:slug` feeds the web page `/apps/:slug`.
- **Identity:** `GithubAuthMiddleware` recognises an RS256 JWT, verifies it against the app's keys with `node:crypto`, and sets `req.githubApp`. A JWT is accepted only on the app-level paths in one allowlist (slice 1: `GET /api/v3/app`); anywhere else it is refused before any handler runs.

**Tech Stack:** NestJS 11, Drizzle, Better Auth 1.7, `node:crypto` (keygen, RS256 verify; no JWT library), vitest + supertest, `@octokit/app` (new devDependency of `apps/api`, e2e only), Next.js for the web pages.

**Spec:** `docs/superpowers/specs/2026-10-25-ghost-apps-design.md` (slice 1, Ghost #103; parent #50)

**Branch:** `feat/ghost-apps-1`, cut from `main`.

## Global Constraints

- Permission names, scopes and levels exactly as the spec's table: `metadata` (read, always granted), `contents`, `pull_requests`, `issues`, `statuses` (read/write), `members` (organization, read only), `administration` (read/write, stored, no behaviour). `write` includes `read`.
- App ID: an integer identity, unique across Ghost, never reused. Slug: never reused, even after delete. `slug[bot]` always means one app.
- Slug is derived from the name at creation and never changes, even on rename (Claude's call: the bot username and every attribution hang on it).
- App name: 1 to 34 characters (GitHub's limit). Slug: `slugify(name, { lower: true, strict: true })`, as team slugs are made: accented letters transliterated, every run of other characters one `-`, ends trimmed. An empty slug is refused.
- JWT rules: header `alg` must be `RS256`; `iss` is the App ID (number, or a string of digits); `iat <= now + 60`; `exp > now`; `exp - iat <= 600`. Signed by any of the app's current keys.
- JWT error bodies are GitHub's: `401 { "message": "A JSON web token could not be decoded", "documentation_url": "https://docs.github.com/rest" }` for malformed tokens, a wrong signature, an unknown or deleted app, a non-RS256 `alg` or a bad `iat`; `401 "'Expiration time' claim ('exp') is too far in the future"` when `exp - iat > 600`; `401 "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires"` when expired.
- A valid JWT on any path outside the allowlist: `403 { "message": "Resource not accessible by integration" }` (GitHub's message for integration callers). It never falls through as anonymous.
- Bot user: `email` is `<slug>[bot]@bots.invalid`, `emailVerified` false, no `account` row. Refused a session in the `session.create.before` hook and refused by `verifyApiKey` for any key it might own.
- The web route `/apps` makes `apps` a reserved name (`RESERVED_NAMES` in `apps/api/src/lib/auth.ts`).
- Private key: RSA 2048, returned once as PKCS#1 PEM (`-----BEGIN RSA PRIVATE KEY-----`, what GitHub hands out). Stored: SPKI PEM public key and `SHA256:<base64 sha256 of the DER public key>` fingerprint. At most 20 keys per app.
- Webhook URL and secret are stored now and delivered in slice 3. The secret is write-only, sealed with `sealWebhookSecret` like `webhook_endpoint`'s.
- Code standards (`docs/code-standards.md`): pure functions and errors under `lib/apps/`, `services/` only `@Injectable()`, controllers pass, no wrapped strings or comments, no one- or two-line helpers.
- Migrations: `bun db:generate` at the root, never hand-edited.
- Rate limiting: a JWT caller counts as anonymous in slice 1 (`ponytail:` note in the middleware; per-app budget arrives with installations in slice 2).
- E2E only on throwaway Postgres, rustfs and Redis (memory: api-e2e-known-failures). `$E2E` below means `PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH TEST_DATABASE_URL=... TEST_S3_ENDPOINT=http://localhost:59000 TEST_REDIS_URL=redis://localhost:56379 npx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism`, run from `apps/api`.

## Review Focus

1. **A user or org named `apps`.** `/apps/:slug` shadows `/[username]` for that name. `apps` joins `RESERVED_NAMES`; before merge, check prod for an existing user or org named `apps` and tell the user. Test in Task 1.
2. **Deleting the owning organization.** A hard cascade would drop the app row and free its App ID and slug for reuse. Owner FKs are `set null`, a check constraint refuses an undeleted app without an owner, and `beforeDeleteOrganization` soft-deletes the org's apps first. Test in Task 2.
3. **A JWT on a non-app endpoint or on git.** It must not be read as anonymous on REST or GraphQL, and must not pass git Basic auth. Test in Task 4.
4. **`alg: none` / `HS256` with the public key as secret.** Classic JWT forgery. Only `RS256` is accepted, checked before verifying. Test in Task 3.
5. **Raising permissions or events on an app with installations.** Slice 1 has no installations, so nothing to refuse yet; the refusal ships with installations in slice 2. No test here; slice 2's plan owns it.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/db/src/schema/apps.ts` | `app`, `app_public_key` tables |
| `packages/db/src/schema/auth.ts` | `user.kind` column (`'user' \| 'bot'`, default `'user'`) |
| `packages/permissions/src/apps.ts` | Permission table and event-to-permission map, shared by api and web |
| `apps/api/src/lib/apps/permissions.ts` | `grants`, validation over that table |
| `apps/api/src/lib/apps/slug.ts` | `appSlug(name)` |
| `apps/api/src/lib/apps/app-jwt.ts` | Decode and verify an app JWT, pure |
| `apps/api/src/lib/apps/apps.errors.ts` | Domain errors for apps and JWTs |
| `apps/api/src/resources/apps/` | `apps.module.ts`, `apps.controller.ts` (owner + org + public), `apps.service.ts`, `dto/app.dto.ts` |
| `apps/api/src/services/apps/app-jwt.service.ts` | Loads an app's keys and calls `verifyAppJwt` |
| `apps/api/src/github/rest/app/` | `app.module.ts`, `app.controller.ts` (`GET /api/v3/app`), `app.service.ts`, `dto/app.dto.ts` |
| `apps/api/src/github/auth/` | `github-request.ts` (`githubApp`), `github-auth.middleware.ts` (JWT branch), `viewer.decorator.ts` (`CallingApp`) |
| `apps/api/src/lib/github/rest.ts`, `node-id.ts` | `toUserRest` type `'Bot'`, node prefix `Bot: 'BOT'`, `App: 'APP'` |
| `apps/web/src/app/settings/apps/`, `apps/web/src/app/[username]/settings/apps/`, `apps/web/src/app/apps/[slug]/`, `apps/web/src/components/apps/` | Task 5 |
| `apps/docs/content/docs/apps/` | Task 5 docs stub |

---

### Task 1: Schema, bot user and lockout

**Files:**
- Create: `packages/db/src/schema/apps.ts`
- Modify: `packages/db/src/schema/auth.ts`, `packages/db/src/schema/index.ts`, `apps/api/src/lib/auth.ts` (`RESERVED_NAMES`, `session.create.before`), `apps/api/src/lib/api-keys/verify-api-key.ts`
- Test: `apps/api/test/apps-identity.e2e-spec.ts`

**Interfaces (produces):**
```ts
// schema/auth.ts
user.kind: text('kind', { enum: ['user', 'bot'] }).notNull().default('user')

// schema/apps.ts
export const app = pgTable('app', {
  id: text('id').primaryKey(),
  numericId: bigint('numeric_id', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(), // App ID
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  homepageUrl: text('homepage_url').notNull(),
  setupUrl: text('setup_url'),
  logoUrl: text('logo_url'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'), // sealed
  permissions: jsonb('permissions').$type<AppPermissions>().notNull(),
  events: text('events').array().notNull(),
  ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
  ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'set null' }),
  botUserId: text('bot_user_id').notNull().unique().references(() => user.id), // no cascade
  createdAt, updatedAt, deletedAt: timestamp(..., { withTimezone: true }),
}, (t) => [check('app_owner', sql`${t.deletedAt} is not null or num_nonnulls(${t.ownerUserId}, ${t.ownerOrganizationId}) = 1`), index on each owner column]);

export const appPublicKey = pgTable('app_public_key', {
  id: text('id').primaryKey(),
  appId: text('app_id').notNull().references(() => app.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(), // SPKI PEM
  fingerprint: text('fingerprint').notNull(),
  createdAt,
}, (t) => [index('app_public_key_app_id_idx').on(t.appId)]);
```

- [x] **Step 1 (Claude): Write the failing tests** in `apps-identity.e2e-spec.ts`. Bot rows are inserted directly (`kind: 'bot'`, username `idbot<stamp>[bot]`) so this task stands alone.
  - `refuses the username apps`: signing up as `apps` is refused with `That name is reserved`.
  - `never opens a session for a bot`: `(await auth.$context).internalAdapter.createSession(botId)` rejects.
  - `rejects an API key a bot owns`: a key created server-side for the bot gets `401` on `GET /api/v3/user` and on git `GET /:owner/:repo.git/info/refs?service=git-upload-pack` with it as Basic password.
  - `defaults existing users to kind user`: a fresh `signUp` row has `kind: 'user'`.
  - `refuses an app without an owner`: inserting an `app` row with both owner columns null and `deletedAt` null throws a check violation; with `deletedAt` set it succeeds.
- [x] **Step 2 (Claude): Run red.** `$E2E test/apps-identity.e2e-spec.ts`. Expected: FAIL (no `kind` column, no `app` table).
- [x] **Step 3 (user): Implement** the schema, `bun db:generate`, the reserved name, the session hook (look the user up by `session.userId`, throw `APIError('FORBIDDEN')` for `kind = 'bot'`), and the bot check in `verifyApiKey` (return null when `key.referenceId` is a bot).
- [x] **Step 4 (Claude): Run green and audit.** Same command, PASS. Run `test/oauth-apps.e2e-spec.ts` and `test/github-scopes.e2e-spec.ts` too: key verification changed under them.
- [x] **Step 5: Commit** `Add apps, private keys and bot users`.

### Task 2: Owner endpoints

**Files:**
- Create: `packages/permissions/src/apps.ts` (exported from its `index.ts`), `lib/apps/permissions.ts`, `lib/apps/slug.ts`, `lib/apps/apps.errors.ts`, `resources/apps/{apps.module,apps.controller,apps.service}.ts`, `resources/apps/dto/app.dto.ts`
- Modify: `app.module.ts`, `lib/auth.ts` (`beforeDeleteOrganization` soft-deletes the org's apps)
- Test: `lib/apps/permissions.spec.ts`, `lib/apps/slug.spec.ts`, `apps/api/test/apps.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 tables; `administeredOrganization`, `AvatarStorageService`, `sealWebhookSecret`, `webhookEvents`.
- Produces:
```ts
// packages/permissions/src/apps.ts
export const APP_PERMISSIONS = { metadata: ['read'], contents: ['read', 'write'], pull_requests: ['read', 'write'], issues: ['read', 'write'], statuses: ['read', 'write'], members: ['read'], administration: ['read', 'write'] } as const;
export type AppPermission = keyof typeof APP_PERMISSIONS;
export type AppPermissions = Partial<Record<AppPermission, 'read' | 'write'>>;
export const EVENT_PERMISSIONS: Record<string, AppPermission>; // keyed by Ghost event name; push, release.*: contents; issue.*: issues; pull_request.*: pull_requests; commit_status.created: statuses; label.*, star.*, watch.started, fork.created, repository.*, member.*: metadata

// apps/api/src/lib/apps/permissions.ts
export function grants(held: AppPermissions, permission: AppPermission, level: 'read' | 'write'): boolean; // metadata:read always true
export function appPermissionsProblem(permissions: Record<string, string>, events: string[]): string | null; // first problem as a sentence, or null
export function withMetadata(permissions: AppPermissions): AppPermissions; // adds metadata: 'read'

// lib/apps/slug.ts
export function appSlug(name: string): string;

// lib/apps/apps.errors.ts
AppNotFoundError (404 'App not found'), AppNameTakenError (422 'An app already uses that name'), InvalidAppPermissionsError (422, message from appPermissionsProblem), TooManyPrivateKeysError (422 'An app can hold at most 20 private keys'), PrivateKeyNotFoundError (404 'Private key not found')

// resources/apps/dto/app.dto.ts
CreateAppDTO { name (1-34); description? (<=400); homepageUrl (http/https URL); setupUrl?; webhookUrl?; webhookSecret? (write-only); permissions: Record<string, 'read'|'write'>; events: string[] }
UpdateAppDTO = PartialType(CreateAppDTO); webhookUrl/setupUrl/description accept null to clear
AppOwnerDTO { login: string; type: 'user' | 'organization' }
AppPrivateKeyDTO { id; fingerprint; createdAt }
AppDTO { id; appId: number; slug; botLogin: `${slug}[bot]`; name; description|null; homepageUrl; setupUrl|null; logoUrl|null; webhookUrl|null; webhookSecretSet: boolean; permissions: AppPermissions (metadata included); events: string[]; owner: AppOwnerDTO; privateKeys: AppPrivateKeyDTO[]; installUrl: `${web}/apps/${slug}/installations/new`; createdAt }
PublicAppDTO { appId; slug; name; description|null; homepageUrl; logoUrl|null; owner: AppOwnerDTO; installUrl }
CreatedPrivateKeyDTO extends AppPrivateKeyDTO { privateKey: string } // PKCS#1 PEM, shown once
ListAppsResponseDTO { apps: AppDTO[] }
```
Routes (all `@CookieOnly()` except the public read, which is anonymous):

| Route | Answer |
|---|---|
| `GET /api/apps` | user's own live apps |
| `POST /api/apps` | 201 `AppDTO`; creates the app and its bot user in one transaction |
| `GET /api/organizations/:slug/apps`, `POST` same | org admins |
| `GET /api/apps/:slug` | `PublicAppDTO`, anyone, 404 when deleted |
| `GET /api/apps/:slug/settings` | `AppDTO`, owner or org admin |
| `PATCH /api/apps/:slug` | `AppDTO`; rename updates the bot's `name`, never the slug |
| `DELETE /api/apps/:slug` | 204; sets `deletedAt`, deletes keys, clears webhook; bot user kept |
| `POST /api/apps/:slug/private-keys` | 201 `CreatedPrivateKeyDTO` |
| `DELETE /api/apps/:slug/private-keys/:id` | 204 |
| `PUT`/`DELETE /api/apps/:slug/logo` | as OAuth apps' logo; also sets the bot user's `image` |

Someone else's app, or a deleted one, answers 404 on every management route.

- [ ] **Step 1 (Claude): Write the failing tests.**
  - `slug.spec.ts`: `'My CI Bot'` → `'my-ci-bot'`; `'  Lint!!  bot  '` → `'lint-bot'`; `'Ünïcode'` → `'unicode'`; `'!!!'` → `''`.
  - `permissions.spec.ts`: `grants({}, 'metadata', 'read')` true; `grants({ contents: 'write' }, 'contents', 'read')` true; `grants({ contents: 'read' }, 'contents', 'write')` false; `appPermissionsProblem({ members: 'write' }, [])` names `members`; `({ secrets: 'read' }, [])` names `secrets`; `({}, ['push'])` is `'push needs contents:read'`; `({ issues: 'read' }, ['issue.opened'])` is null; unknown event `'nope'` named; every `webhookEvents` entry has an `EVENT_PERMISSIONS` entry.
  - `apps.e2e-spec.ts`:
    - `registers an app with its bot user`: POST `{ name: 'CI Bot <stamp>', homepageUrl, permissions: { statuses: 'write' }, events: ['commit_status.created'] }` → 201 with integer `appId`, `slug`, `botLogin === slug + '[bot]'`, `permissions` `{ metadata: 'read', statuses: 'write' }`, `owner: { login, type: 'user' }`, `installUrl` ending `/apps/${slug}/installations/new`, `privateKeys: []`. DB: a `user` row with `kind: 'bot'`, `username: botLogin`, no `account` row.
    - `refuses a name another app took, even a deleted one`: create, delete, create the same name → 422 `An app already uses that name`.
    - `keeps the slug on rename`: PATCH `name` → same `slug`, new `name`, bot user `name` updated.
    - `refuses bad permissions and events`: `{ members: 'write' }` → 422; `events: ['push']` without `contents` → 422 `push needs contents:read`; name of 35 characters → 400.
    - `generates a private key once and stores only the public half`: POST key → 201, `privateKey` starts `-----BEGIN RSA PRIVATE KEY-----`, `fingerprint` starts `SHA256:`; `crypto.createPublicKey(privateKey)` exported SPKI equals the stored `public_key`; no column of `app_public_key` contains the private PEM; settings GET lists the key without `privateKey`.
    - `deletes a key`: DELETE → 204, settings no longer list it; another app's key id → 404.
    - `caps keys at 20`: 21st → 422.
    - `hides another user's app`: `other` gets 404 on settings, PATCH, DELETE, key POST; public GET works for `other` and anonymous, and carries no `webhookUrl`, `permissions` or `privateKeys`.
    - `stores the webhook secret sealed and never returns it`: create with `webhookSecret: 'shh'` → `webhookSecretSet: true`, no response contains `shh`, DB column is not `shh`.
    - `deletes an app but keeps its bot`: DELETE → 204; public GET → 404; bot user row still exists; `app_public_key` rows gone; App ID still on the row.
    - `organization apps`: admin POSTs to `/api/organizations/:org/apps` → `owner.type: 'organization'`; a plain member gets the admin refusal `administeredOrganization` throws; admin manages it at `/api/apps/:slug/settings`; deleting the organization leaves the app row with `deletedAt` set and its slug still refused.
    - `refuses an API key`: any management route with `Authorization: token <key>` and no cookie → 401 or 403 as `@CookieOnly()` answers for OAuth apps.
- [ ] **Step 2 (Claude): Run red.** `npx vitest run src/lib/apps` and `$E2E test/apps.e2e-spec.ts`. Expected: FAIL, modules missing.
- [ ] **Step 3 (user): Implement** the libs, DTOs, service and controllers. Key generation: `generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } })`.
- [ ] **Step 4 (Claude): Run green and audit.** Both commands PASS; `test/organizations.e2e-spec.ts` still green (org delete hook).
- [ ] **Step 5: Commit** `Register Ghost Apps and their private keys`.

### Task 3: JWT verification

**Files:**
- Create: `lib/apps/app-jwt.ts`, `services/apps/app-jwt.service.ts`
- Modify: `lib/apps/apps.errors.ts` (`AppJwtError`)
- Test: `lib/apps/app-jwt.spec.ts`

**Interfaces:**
- Consumes: `app`, `appPublicKey`.
- Produces:
```ts
// lib/apps/app-jwt.ts
export const APP_JWT = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/; // how the middleware tells a JWT from an API key
export type AppJwtClaims = { iss: number; iat: number; exp: number };
export function decodeAppJwt(token: string): AppJwtClaims; // throws AppJwtError; checks alg === 'RS256', iss digits, iat/exp integers
export function verifyAppJwt(token: string, claims: AppJwtClaims, publicKeys: string[], now: number): void; // throws AppJwtError; signature against any key, then the time rules

// lib/apps/apps.errors.ts
export class AppJwtError extends DomainError { status = 401 } // message is one of Global Constraints' three
export const JWT_UNDECODABLE = 'A JSON web token could not be decoded';

// services/apps/app-jwt.service.ts
@Injectable() export class AppJwtService { verify(token: string): Promise<{ appId: string; numericId: number }> } // throws AppJwtError; deleted or unknown app → JWT_UNDECODABLE
```

- [ ] **Step 1 (Claude): Write the failing tests** in `app-jwt.spec.ts`. A helper signs with `crypto.sign('sha256', ...)` from a fresh keypair; `now = 1_761_480_000`.
  - `accepts what Octokit signs`: `iat = now - 30`, `exp = now + 570`, `iss: 42` → no throw; `iss: '42'` decodes to `42`.
  - `accepts any current key`: signed with key B, keys `[A, B]` → no throw.
  - `refuses a wrong signature`, `refuses alg none`, `refuses HS256 signed with the public PEM as secret`, `refuses three random segments`, `refuses iss 'abc'` → `AppJwtError` with `JWT_UNDECODABLE`.
  - `allows 60 seconds of clock drift`: `iat = now + 60` passes, `now + 61` refused.
  - `refuses a ten-minute-and-one-second token`: `exp - iat = 601` → message `'Expiration time' claim ('exp') is too far in the future`.
  - `refuses an expired token`: `exp = now` → the `must be a numeric value representing the future time` message.
- [ ] **Step 2 (Claude): Run red.** `npx vitest run src/lib/apps/app-jwt.spec.ts`. Expected: FAIL, module missing.
- [ ] **Step 3 (user): Implement** with `crypto.verify('sha256', signingInput, publicKey, signature)`; base64url via `Buffer.from(x, 'base64url')`.
- [ ] **Step 4 (Claude): Run green.** Same command, PASS.
- [ ] **Step 5: Commit** `Verify Ghost App JWTs`.

### Task 4: `GET /app`, JWT in the middleware, bot users over REST

**Files:**
- Create: `github/rest/app/{app.module,app.controller,app.service}.ts`, `github/rest/app/dto/app.dto.ts`
- Modify: `github/auth/github-request.ts`, `github/auth/github-auth.middleware.ts`, `github/auth/viewer.decorator.ts`, `github/github.module.ts`, `lib/github/rest.ts` (`'Bot'` type), `lib/github/node-id.ts` (`Bot: 'BOT'`, `App: 'APP'`), `github/rest/users/users.service.ts` (`type: 'Bot'` for `kind = 'bot'`), `github/rest/users/dto/user.dto.ts` (enum adds `'Bot'`), `apps/api/package.json` (devDependency `@octokit/app`)
- Test: `apps/api/test/github-app.e2e-spec.ts`, `github/openapi.spec.ts` if it lists routes

**Interfaces:**
- Consumes: `AppJwtService.verify`, `JWT_UNDECODABLE`, `withMetadata`, `toUserRest`.
- Produces:
```ts
// github-request.ts
export type GithubApp = { appId: string; numericId: number };
export type GithubRequest = Request & { githubViewer: GithubViewer | null; githubApp: GithubApp | null };

// github-auth.middleware.ts
const APP_JWT_ROUTES: { method: string; path: RegExp }[] = [{ method: 'GET', path: /^\/api\/v3\/app\/?(?:\?|$)/ }]; // slice 2 adds its installation routes here

// viewer.decorator.ts
export const CallingApp: () => ParameterDecorator; // req.githubApp

// github/rest/app/dto/app.dto.ts, GitHub's integration object
GithubAppDTO { id: number; slug; node_id; owner: GithubSimpleUserDTO; name; description: string | null; external_url; html_url: `${web}/apps/${slug}`; created_at; updated_at; permissions: Record<string, 'read'|'write'>; events: string[]; installations_count: 0 }
```
`GET /api/v3/app` without an app JWT (no auth, a user key, a session): `401` `JWT_UNDECODABLE`, as GitHub answers a user token there.

- [ ] **Step 1 (Claude): Write the failing tests** in `github-app.e2e-spec.ts`. Register an app through `POST /api/apps` with `permissions: { contents: 'read' }`, `events: ['push']`, generate a key.
  - `Octokit's App reads GET /app`: `new App({ appId, privateKey, Octokit: Octokit.defaults({ baseUrl: '<server>/api/v3' }) })`, `app.octokit.request('GET /app')` → `id === appId`, `slug`, `name`, `owner.login`, `owner.type === 'User'`, `html_url` ends `/apps/${slug}`, `permissions` `{ metadata: 'read', contents: 'read' }`, `events: ['push']`, `installations_count: 0`.
  - `org app owner is an Organization`: an org app's `owner.type === 'Organization'`.
  - `refuses a JWT signed by a deleted key`, `refuses a JWT for a deleted app` → 401 `JWT_UNDECODABLE`.
  - `refuses a user key on GET /app` → 401 `JWT_UNDECODABLE`; anonymous → same.
  - `confines a JWT to the app routes`: with a valid JWT, `GET /api/v3/user`, `GET /api/v3/repos/:owner/:repo` of a public repo, and `POST /api/graphql` each → 403 `Resource not accessible by integration`.
  - `refuses a JWT as a git password`: Basic `x-access-token:<jwt>` on `info/refs` of a private repo → 401.
  - `serves the bot as a Bot`: `GET /api/v3/users/${encodeURIComponent(botLogin)}` → `login: botLogin`, `type: 'Bot'`, `avatar_url` the app's logo after a logo upload.
- [ ] **Step 2 (Claude): Run red.** `$E2E test/github-app.e2e-spec.ts`. Expected: FAIL, 404 on `/api/v3/app`.
- [ ] **Step 3 (user): Implement.** In the middleware, test `APP_JWT` before `verifyApiKey`; on `AppJwtError` answer its status and GitHub body; on success set `githubApp`, leave `githubViewer` null, and refuse with 403 unless the request matches `APP_JWT_ROUTES`. Every other path sets `githubApp = null`.
- [ ] **Step 4 (Claude): Run green and audit.** Same command, PASS; then the whole `$E2E` suite, compared against the known failures in memory.
- [ ] **Step 5: Commit** `Authenticate as a Ghost App and serve GET /app`.

### Task 5 (Claude, after the audit): Web pages and docs stub

**Files:**
- Create: `apps/web/src/components/apps/` (list, create form with the `slug[bot]` preview, permission table, events filtered by `EVENT_PERMISSIONS`, private-keys card with one-time `.pem` download, delete card), `apps/web/src/app/settings/apps/{page,new/page,[slug]/page}.tsx` + `loading.tsx`, the same under `apps/web/src/app/[username]/settings/apps/`, `apps/web/src/app/apps/[slug]/page.tsx` + `loading.tsx`, `apps/docs/content/docs/apps/{index.mdx,meta.json}`
- Modify: both settings navs (next to OAuth apps), `apps/docs/content/docs/meta.json`

- [ ] **Step 1:** Reuse `components/oauth-apps/` pieces (logo, fields, delete card) by prop before writing new ones (code standards rule 9). The permission table and event filter import `APP_PERMISSIONS` and `EVENT_PERMISSIONS` from `@ghost/permissions`.
- [ ] **Step 2:** Public page `/apps/[slug]`: name, logo, description, homepage, owner link, Install button linking to `installUrl` (it 404s until slice 2 ships the page).
- [ ] **Step 3:** Docs stub: what a Ghost App is, registering, private keys and the JWT rules from Global Constraints, `GET /app`, a "coming next" list naming slices 2-6.
- [ ] **Step 4:** Run the web app, register an app, download a key, run the Task 4 Octokit snippet against it by hand. `bun run lint` and `bun run typecheck` in `apps/web`.
- [ ] **Step 5: Commit** `Ghost App settings, public page and docs stub`.

---

**Done when (issue #103):** an app can be registered, a key generated, and Octokit's `App` class authenticates as the app and reads `GET /app` (Task 4's first test, plus the manual run in Task 5).
