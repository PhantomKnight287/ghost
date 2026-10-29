# Ghost Apps 2: Installations and Installation Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Who does what:** Claude implements all of this slice, backend and frontend, test-first (user decision, 2026-10-29). Every task writes its tests, runs them red, implements, and runs them green.

**Goal:** An owner installs a Ghost App on their account or organization. The app mints one-hour `ghs_` tokens. Those tokens act as `slug[bot]` only where the installation and its accepted permissions allow, over the GitHub-compatible REST layer and git over HTTPS. Rulesets can pin a required check to an app and list an app as a bypass actor.

**Architecture:**
- **Data:** `app_installation` (integer installation id, one per app and account, an accepted permissions and events snapshot, suspension), `app_installation_repository` (the selected repositories) and `app_installation_token` (sha256 of each `ghs_` token, its narrowed permissions and repositories, its expiry). `commit_status.installation_id` records which installation posted a status. `ruleset_bypass_actor` gains `Integration` with `app_id`.
- **Access:** a bot gets the `write` role on every repository its live installations cover. This is one more grant in `roleOf` (`lib/repositories/access/repository-access.ts`), so every service keeps checking access as it does today and writes are attributed to the bot without changes in each service. Rulesets do not see that role (`actorOf` leaves it out), so the bot bypasses nothing unless a ruleset names its app.
- **Enforcement:** `@RequireAppPermission(...)` on controllers and routes, read by one global `AppPermissionGuard`. The guard runs only for installation callers. It checks that the route is declared, that the repository is in the token's installation and repository list, and that the token holds every needed permission. Otherwise it falls back to anonymous for a public read, or refuses.
- **Identity:** `GithubAuthMiddleware` and `GitBasicAuthMiddleware` both recognise `ghs_` tokens through `InstallationTokenService.verify`, and set `req.appInstallation`. JWT routes grow to the installation endpoints.

**Tech Stack:** NestJS 11, Drizzle, `node:crypto` (`randomBytes`, `createHash`), vitest + supertest, `@octokit/app` and `@octokit/rest` (already devDependencies from slice 1), Next.js.

**Spec:** `docs/superpowers/specs/2026-10-25-ghost-apps-design.md` (slice 2, Ghost #104; parent #50). Read the Permissions, Identity and tokens and Anti-goals sections too.

**Branch:** `feat/ghost-apps-2`, cut from `main` (holds the spec commit `b61b85d`).

## Global Constraints

- Permission names and levels as in `APP_PERMISSIONS` (`packages/permissions/src/apps.ts`). `write` includes `read`. `metadata: read` is always granted. `metadata: write` and both `administration` levels grant nothing in this slice.
- A token's effective access to a repository is the intersection of (1) the repository being in its installation, (2) the installation's accepted `permissions`, and (3) the token's own narrowed `permissions` and `repository_ids`. Narrowing never widens.
- Installation token: `ghs_` followed by 36 characters from `[A-Za-z0-9]`, from `randomBytes`. Only `sha256(token)` (hex) is stored. Expires 1 hour after minting. Accepted on the GitHub-compat REST layer (`Authorization: token|Bearer`) and as the git Basic password (username ignored). Refused on Ghost's own API and on GraphQL.
- Refusal for an installation caller: `403 { "message": "Resource not accessible by integration", "documentation_url": "https://docs.github.com/rest" }` (the slice 1 message). On git, `403` with a plain text body of the same message. A private repository outside the installation answers 404, as it does today for anyone who cannot read it.
- Minting errors (GitHub's, verify the wording against docs.github.com while building): suspended `403 "This installation has been suspended"`; a permission above the installation's `422 "The permissions requested are not granted to this installation."`; a repository outside the installation `422 "There is at least one repository that does not exist or is not accessible to the parent installation."`; an unknown installation, or one of another app, `404 "Not Found"`.
- Suspending or uninstalling deletes every token of that installation in the same transaction. Deleting an app deletes its installations and their tokens (soft-deleted apps never fire the FK cascade).
- Until slice 6, an app with any installation refuses raised permissions or added events: `422 "Remove this app's installations before asking for more permissions or events"`. Lowering permissions or removing events rewrites every installation's snapshot in the same transaction, and drops tokens that held more.
- The install page redirects to `setupUrl` with `?installation_id=<id>&setup_action=install` (GitHub's query) when the app has one, else to the installed-apps settings.
- Status attribution: a status posted with an installation token has `creatorId` = the bot and `installationId` set. Any other caller leaves `installationId` null.
- A pinned check (`integration_id`) is satisfied only by the newest status for that context posted by an installation of that app. An unpinned check keeps today's rule: the newest status for the context, whoever posted it.
- Bot approvals count toward `required_approving_review_count` (user decision). A bot satisfies code-owner review only if CODEOWNERS names `@slug[bot]`.
- Rate limits: an installation caller counts against the existing authenticated budget, keyed by the bot's user id (`ponytail:` note: one budget per app across installations, GitHub's is per installation).
- Code standards (`docs/code-standards.md`): pure functions and errors under `lib/apps/`, injectables under `services/`, controllers pass, no `to<format>` reshaping, no wrapped strings or comments, no one- or two-line helpers, one `@Controller` per file.
- Migrations: `bun db:generate` at the root, never hand-edited.
- E2E only against throwaway Postgres, rustfs and Redis. `$E2E` means the slice 1 command: `PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH TEST_DATABASE_URL=... TEST_S3_ENDPOINT=http://localhost:59000 TEST_REDIS_URL=redis://localhost:56379 npx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism`, run from `apps/api`.

## Review Focus

1. **A token of installation A used on a repository of installation B of the same app.** The bot's role covers both, so only the guard's installation check stops it. Test in Task 4 (`refuses a token on another installation's repository`).
2. **A repository transferred out of an installation's account.** Its `app_installation_repository` row survives the transfer. Access must require the account to still own the repository. Test in Task 4 (`loses a repository transferred to another account`).
3. **LFS uploads.** `POST info/lfs/objects/batch` with `operation: upload` mints an LFS upload token. A `contents: read` installation must be refused there, not at the later `PUT`. Test in Task 4.
4. **A token outliving its grant.** Suspending, uninstalling, lowering the app's permissions and deleting the app all leave no working token. Tests in Tasks 2 and 3.
5. **Bypass through the role.** A ruleset whose bypass list holds `RepositoryRole: write` must not let the bot through just because the bot's installation role is `write`. Test in Task 6 (`does not bypass by repository role`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/db/src/schema/apps.ts` | `app_installation`, `app_installation_repository`, `app_installation_token` |
| `packages/db/src/schema/commit-statuses.ts` | `installationId` |
| `packages/db/src/schema/rulesets.ts` | `Integration`, `appId`, check and unique index |
| `apps/api/src/lib/apps/installation-token.ts` | Token generation, hashing, narrowing (pure) |
| `apps/api/src/lib/apps/apps.errors.ts` | Installation errors |
| `apps/api/src/lib/apps/app-permission.ts` | `RequireAppPermission` decorator, metadata key, level resolution (pure) |
| `apps/api/src/lib/git/git-push.ts` | `isGitPush(req)`, moved out of the git middleware |
| `apps/api/src/lib/repositories/access/repository-access.ts` | `installationRoleOf`, `Grants.installationRole` |
| `apps/api/src/resources/installations/` | Ghost API for owners: install, list, configure, suspend, uninstall |
| `apps/api/src/services/apps/installation-tokens.service.ts` | Mint and verify `ghs_` tokens |
| `apps/api/src/services/apps/installation-access.service.ts` | Whether an installation covers a repository |
| `apps/api/src/auth/app-permission.guard.ts` | The global guard |
| `apps/api/src/github/rest/app/` | Installation endpoints at GitHub's paths (one controller per file) |
| `apps/web/src/app/apps/[slug]/installations/new/`, `apps/web/src/app/settings/installations/`, `apps/web/src/app/[username]/settings/installations/`, `apps/web/src/components/installations/` | Task 7 |

---

### Task 1: Schema

**Files:**
- Modify: `packages/db/src/schema/apps.ts`, `packages/db/src/schema/commit-statuses.ts`, `packages/db/src/schema/rulesets.ts`
- Test: `apps/api/test/apps-installations.e2e-spec.ts` (schema block only; Task 2 fills the rest)

**Interfaces (produces):**
```ts
export const appRepositorySelection = pgEnum('app_repository_selection', ['all', 'selected']);

export const appInstallation = pgTable('app_installation', {
  id: text().primaryKey().$defaultFn(() => `ain_${createId()}`),
  numericId: bigint({ mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(), // the installation id GitHub's paths take
  appId: text().notNull().references(() => app.id, { onDelete: 'cascade' }),
  accountUserId: text().references(() => user.id, { onDelete: 'cascade' }),
  accountOrganizationId: text().references(() => organization.id, { onDelete: 'cascade' }),
  repositorySelection: appRepositorySelection().notNull(),
  permissions: jsonb().$type<AppPermissions>().notNull(), // accepted snapshot, metadata included
  events: text().array().notNull(),
  installedById: text().references(() => user.id, { onDelete: 'set null' }),
  suspendedAt: timestamp({ withTimezone: true }),
  suspendedById: text().references(() => user.id, { onDelete: 'set null' }),
  createdAt, updatedAt,
}, (t) => [
  check('app_installation_account', sql`num_nonnulls(${t.accountUserId}, ${t.accountOrganizationId}) = 1`),
  uniqueIndex('app_installation_user_idx').on(t.appId, t.accountUserId),
  uniqueIndex('app_installation_organization_idx').on(t.appId, t.accountOrganizationId),
  index on accountUserId, index on accountOrganizationId,
]);

export const appInstallationRepository = pgTable('app_installation_repository', {
  installationId: text().notNull().references(() => appInstallation.id, { onDelete: 'cascade' }),
  repositoryId: text().notNull().references(() => repository.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.installationId, t.repositoryId] }), index on repositoryId]);

export const appInstallationToken = pgTable('app_installation_token', {
  id: text().primaryKey().$defaultFn(() => `ait_${createId()}`),
  installationId: text().notNull().references(() => appInstallation.id, { onDelete: 'cascade' }),
  tokenHash: text().notNull().unique(),
  permissions: jsonb().$type<AppPermissions>().notNull(),
  repositoryIds: text().array(), // null: every repository of the installation
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt,
}, (t) => [index on installationId, index on expiresAt]);

// commit-statuses.ts
installationId: text().references(() => appInstallation.id, { onDelete: 'set null' }),

// rulesets.ts: enum adds 'Integration'; column
appId: text().references(() => app.id, { onDelete: 'cascade' }),
// check adds: OR (actor_type = 'Integration' AND app_id IS NOT NULL AND role IS NULL AND team_id IS NULL); the other three branches add `app_id IS NULL`
uniqueIndex('ruleset_bypass_actor_app_idx').on(t.rulesetId, t.appId),
```

- [ ] **Step 1: Write the failing tests** in the `schema` describe of `apps-installations.e2e-spec.ts`, inserting rows directly:
  - `refuses an installation with no account or two accounts`: both owner columns null throws a check violation, and so do both set.
  - `refuses a second installation of an app on one account`: a second row with the same `appId` and `accountUserId` throws a unique violation.
  - `drops installations with their organization`: deleting the organization removes its installation and that installation's tokens.
  - `refuses an Integration bypass actor without an app`: `actorType: 'Integration'`, `appId: null` throws a check violation.
- [ ] **Step 2: Run red.** `$E2E test/apps-installations.e2e-spec.ts -t schema`. Expected: FAIL, missing tables.
- [ ] **Step 3: Implement** the schema, then `bun db:generate` at the root.
- [ ] **Step 4: Run green.** Same command, PASS. `TEST_DATABASE_URL=... npx vitest run src/lib/rulesets src/services/rulesets` still green (the check constraint changed under them).
- [ ] **Step 5: Commit** `Add app installations, installation tokens and Integration bypass actors`.

### Task 2: Installing and managing installations (Ghost API)

**Files:**
- Create: `resources/installations/{installations.module,installations.controller,organization-installations.controller,installations.service}.ts`, `resources/installations/dto/installation.dto.ts`
- Modify: `lib/apps/apps.errors.ts`, `resources/apps/apps.service.ts` (delete removes installations; permission raise refused; lowering propagates), `resources/apps/dto/app.dto.ts` (`AppDTO.installationsCount`), `app.module.ts`
- Test: `apps/api/test/apps-installations.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 tables; `administeredOrganization`; `grants`, `withMetadata` from `lib/apps/permissions.ts`.
- Produces:
```ts
// lib/apps/apps.errors.ts
InstallationNotFoundError (404 'Installation not found'),
AlreadyInstalledError (422 'This app is already installed on that account'),
InstallationRepositoryError (422 'Pick repositories the account owns'),
PermissionRaiseError (422 "Remove this app's installations before asking for more permissions or events")

// dto/installation.dto.ts
CreateInstallationDTO { account: string /* login: the caller, or an org they admin */; repositorySelection: 'all' | 'selected'; repositoryIds?: string[] /* required, 1+, when 'selected' */ }
UpdateInstallationDTO { repositorySelection: 'all' | 'selected'; repositoryIds?: string[] }
InstallationDTO { id: string; installationId: number; app: PublicAppDTO; account: AppOwnerDTO; repositorySelection; repositories: { id: string; fullName: string }[] /* 'selected' only, else [] */; permissions: AppPermissions; events: string[]; suspendedAt: string | null; createdAt: string; redirectUrl: string /* setupUrl?installation_id=…&setup_action=install, or the settings page */ }
ListInstallationsResponseDTO { installations: InstallationDTO[] }
```
Routes (all `@CookieOnly()`):

| Route | Answer |
|---|---|
| `POST /api/apps/:slug/installations` | 201 `InstallationDTO`. Snapshot = the app's current permissions and events. |
| `GET /api/installations` | the caller's own account's installations |
| `GET /api/organizations/:slug/installations` | org admins |
| `PATCH /api/installations/:id` | `InstallationDTO`; replaces the repository selection |
| `PUT /api/installations/:id/suspended` | 204; sets `suspendedAt`, `suspendedById`, deletes tokens |
| `DELETE /api/installations/:id/suspended` | 204; clears suspension |
| `DELETE /api/installations/:id` | 204; deletes the row (tokens cascade) |

The `:id` routes answer 404 to anyone who is not the account (or an admin of the organization account).

- [ ] **Step 1: Write the failing tests** in `apps-installations.e2e-spec.ts`. The app is registered by `appOwner` through `POST /api/apps` with `permissions: { issues: 'write' }, events: ['issue.opened']`. `installer` owns two repositories, `r1` and `r2`.
  - `installs on all repositories`: `installer` POSTs `{ account: installer, repositorySelection: 'all' }` → 201, `installationId` is an integer, `permissions: { metadata: 'read', issues: 'write' }`, `repositories: []`, `redirectUrl` ends `/settings/installations`.
  - `installs on selected repositories`: `{ repositorySelection: 'selected', repositoryIds: [r1.id] }` → `repositories` lists only `r1` with its `fullName`.
  - `redirects to the setup URL`: after `PATCH /api/apps/:slug { setupUrl: 'https://ci.example/setup' }`, the new install's `redirectUrl` is `https://ci.example/setup?installation_id=<installationId>&setup_action=install`.
  - `refuses repositories the account does not own`: `repositoryIds: [someoneElsesRepo.id]` → 422; `'selected'` with no ids → 400.
  - `refuses a second install on one account` → 422 `This app is already installed on that account`.
  - `installs on an organization the caller admins`: account `org` → `account.type: 'organization'`; a plain member → the `administeredOrganization` refusal; the admin lists it at `GET /api/organizations/:org/installations`.
  - `reconfigures repositories`: PATCH to `selected` `[r2.id]` → only `r2`; PATCH to `all` → `repositories: []`.
  - `suspends and unsuspends`: PUT `suspended` → 204, and GET shows `suspendedAt`; any token row of the installation (insert one directly) is gone; DELETE `suspended` → `suspendedAt: null`.
  - `uninstalls`: DELETE → 204, the list is empty, token rows are gone.
  - `hides another account's installation`: `appOwner` (who owns the app but not the account) gets 404 on PATCH, suspend and DELETE.
  - `refuses raising permissions while installed`: `PATCH /api/apps/:slug { permissions: { issues: 'write', contents: 'read' } }` → 422 with the PermissionRaiseError message; adding the event `issue.closed` → the same.
  - `lowers permissions on every installation`: PATCH `{ permissions: { issues: 'read' }, events: [] }` → 200; the installation's `permissions` are `{ metadata: 'read', issues: 'read' }`, `events: []`; a token row holding `issues: write` is gone.
  - `deleting an app removes its installations`: `DELETE /api/apps/:slug` → the installation row and its tokens are gone.
  - `counts installations`: `GET /api/apps/:slug/settings` → `installationsCount: 1`.
- [ ] **Step 2: Run red.** `$E2E test/apps-installations.e2e-spec.ts`. Expected: FAIL, 404 on the new routes.
- [ ] **Step 3: Implement** the module, controllers (user and organization in separate files), service and DTOs. A raise means a permission whose level `grants` does not already cover on the current set, or an event not in the current list.
- [ ] **Step 4: Run green.** Same command, PASS; `$E2E test/apps.e2e-spec.ts` still green.
- [ ] **Step 5: Commit** `Install Ghost Apps on accounts and organizations`.

### Task 3: Installation tokens and the GitHub installation endpoints

**Files:**
- Create: `lib/apps/installation-token.ts`, `services/apps/installation-tokens.service.ts`, `github/rest/app/installations.controller.ts` (the `/app/installations*` JWT routes), `github/rest/app/installation-lookup.controller.ts` (`/repos|orgs|users/.../installation`), `github/rest/app/installation-repositories.controller.ts` (`/installation/repositories`), `github/rest/app/installations.service.ts`, `github/rest/app/dto/installation.dto.ts`
- Modify: `github/auth/github-request.ts`, `github/auth/github-auth.middleware.ts` (`ghs_` branch, `APP_JWT_ROUTES`, GraphQL refusal), `git/middleware/git-basic-auth/git-basic-auth.middleware.ts`, `git/types.ts`, `github/auth/require-scopes.ts`, `github/rest/app/app.service.ts` (`installations_count`), `github/rest/app/app.module.ts`
- Test: `lib/apps/installation-token.spec.ts`, `apps/api/test/github-installations.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 tables; `AppJwtService`; `CallingApp`; `grants`.
- Produces:
```ts
// lib/apps/installation-token.ts
export const INSTALLATION_TOKEN = /^ghs_[A-Za-z0-9]{36}$/;
export const INSTALLATION_TOKEN_TTL_MS = 60 * 60 * 1000;
export function generateInstallationToken(): { token: string; hash: string };
export function hashInstallationToken(token: string): string; // sha256 hex
export function narrowPermissions(granted: AppPermissions, requested: Record<string, string> | undefined): AppPermissions; // throws InstallationPermissionsError when requested exceeds granted or names an unknown permission; undefined → granted

// lib/apps/apps.errors.ts adds
InstallationSuspendedError (403 'This installation has been suspended'),
InstallationPermissionsError (422 'The permissions requested are not granted to this installation.'),
InstallationRepositoriesError (422 'There is at least one repository that does not exist or is not accessible to the parent installation.'),
IntegrationForbiddenError (403 'Resource not accessible by integration')

// github-request.ts
export type AppInstallationCaller = { installationId: string; numericId: number; appId: string; botUserId: string; permissions: AppPermissions; repositoryIds: string[] | null };
export type GithubViewer = { userId: string; scopes: readonly string[]; oauthClientId: string | null; installation: AppInstallationCaller | null };
export type GithubRequest = Request & { githubViewer: GithubViewer | null; githubApp: GithubApp | null; appInstallation?: AppInstallationCaller | null };
// git/types.ts: GitAuthenticatedBufferedRequest gains appInstallation?: AppInstallationCaller | null

// services/apps/installation-tokens.service.ts
@Injectable() export class InstallationTokensService {
  mint(app: GithubApp, installationNumericId: number, body: { permissions?: Record<string, string>; repositories?: string[]; repository_ids?: number[] }): Promise<{ token: string; expiresAt: Date; permissions: AppPermissions; repositorySelection: 'all' | 'selected'; repositoryIds: string[] | null }>;
  verify(token: string): Promise<AppInstallationCaller | null>; // null: unknown, expired, suspended, app deleted
}

// dto/installation.dto.ts, GitHub's shapes
GithubInstallationDTO { id: number; account: GithubSimpleUserDTO; repository_selection; access_tokens_url; repositories_url; html_url; app_id: number; app_slug; target_id: number; target_type: 'User' | 'Organization'; permissions; events; created_at; updated_at; single_file_name: null; suspended_at: string | null; suspended_by: GithubSimpleUserDTO | null }
GithubInstallationTokenDTO { token; expires_at; permissions; repository_selection; repositories?: GithubRepositoryDTO[] /* when narrowed */ }
GithubInstallationRepositoriesDTO { total_count: number; repository_selection; repositories: GithubRepositoryDTO[] }
```
`requireScope` and `requireWriteScope` return early when `viewer.installation` is set: an installation is governed by `@RequireAppPermission`, not by scopes. An installation viewer's `scopes` is `[]`, and `X-OAuth-Scopes` is empty.

Routes:

| Route | Caller | Answer |
|---|---|---|
| `GET /api/v3/app/installations` | JWT | the app's installations, `per_page`/`page` |
| `GET /api/v3/app/installations/:installation_id` | JWT | one, 404 when it belongs to another app |
| `DELETE /api/v3/app/installations/:installation_id` | JWT | 204, uninstalls |
| `POST /api/v3/app/installations/:installation_id/access_tokens` | JWT | 201 `GithubInstallationTokenDTO` |
| `GET /api/v3/repos/:owner/:repo/installation`, `GET /api/v3/orgs/:org/installation`, `GET /api/v3/users/:username/installation` | JWT | the app's installation covering it, else 404 |
| `GET /api/v3/installation/repositories` | `ghs_` | the token's repositories, `per_page`/`page` |

Every JWT route joins `APP_JWT_ROUTES`.

- [ ] **Step 1: Write the failing tests.**
  - `installation-token.spec.ts`: a generated token matches `INSTALLATION_TOKEN`; `hash` equals `hashInstallationToken(token)` and is 64 hex characters; two calls differ. `narrowPermissions({ metadata: 'read', issues: 'write' }, { issues: 'read' })` → `{ metadata: 'read', issues: 'read' }`; `({ issues: 'read' }, { issues: 'write' })` and `({ issues: 'read' }, { contents: 'read' })` and `({}, { secrets: 'read' })` throw `InstallationPermissionsError`; `undefined` → granted.
  - `github-installations.e2e-spec.ts`: the app has `{ issues: 'write', contents: 'read' }`, and `installer` installs it on `selected` `[r1]` through the Task 2 route. `app = new App({ appId, privateKey, Octokit: Octokit.defaults({ baseUrl }) })`.
    - `lists and reads installations`: `app.octokit.request('GET /app/installations')` → one entry with `id === installationId`, `account.login === installer`, `target_type: 'User'`, `app_slug`, `repository_selection: 'selected'`; `GET /app/installations/{id}` same; `GET /app` → `installations_count: 1`.
    - `finds the installation of a repository, user and organization`: `GET /repos/{installer}/{r1}/installation` → that id; `GET /users/{installer}/installation` → that id; a repository of another account → 404.
    - `mints a token Octokit uses`: `await app.getInstallationOctokit(installationId)` then `GET /installation/repositories` → `total_count: 1`, `repositories[0].name === r1`. The raw mint response has `token` matching `INSTALLATION_TOKEN`, `expires_at` 3600 s after now (±60 s), `permissions: { metadata: 'read', issues: 'write', contents: 'read' }`. Only the hash is in `app_installation_token`.
    - `narrows a token`: mint with `{ permissions: { issues: 'read' } }` → `permissions: { metadata: 'read', issues: 'read' }`; with `{ repositories: [r2] }` (not installed) → 422 with the InstallationRepositoriesError message; with `{ permissions: { issues: 'write', statuses: 'write' } }` → 422 with the InstallationPermissionsError message.
    - `refuses another app's installation`: a second app's JWT on this installation's `access_tokens` → 404.
    - `refuses a suspended installation`: suspend through Task 2 → mint gives 403 `This installation has been suspended`; a token minted before suspending gets 401 `Bad credentials` on `/installation/repositories`.
    - `expires a token`: set its row's `expiresAt` to the past → 401 `Bad credentials`.
    - `an app uninstalls itself`: `DELETE /app/installations/{id}` → 204; the Task 2 list is empty; the token gets 401.
    - `refuses a token on GraphQL and on Ghost's API`: `POST /api/graphql` with it → 403 `Resource not accessible by integration`; `GET /api/users/me` (or any Ghost API route an API key reaches) with `Authorization: Bearer <token>` → 401.
    - `refuses a token as a JWT and a JWT as a token`: a `ghs_` token on `GET /app/installations` → 401 `A JSON web token could not be decoded`; a JWT on `/installation/repositories` → 403 `Resource not accessible by integration`.
    - `accepts a token as a git password`: `x-access-token:<token>` Basic on `GET /{installer}/{r1}.git/info/refs?service=git-upload-pack` → 200 (enforcement is Task 4).
- [ ] **Step 2: Run red.** `npx vitest run src/lib/apps/installation-token.spec.ts` and `$E2E test/github-installations.e2e-spec.ts`. Expected: FAIL, missing module and 404s.
- [ ] **Step 3: Implement.** In `GithubAuthMiddleware`, test `INSTALLATION_TOKEN` before `APP_JWT` and before `verifyApiKey`; a token that does not verify is `badCredentials`. Set `githubViewer = { userId: botUserId, scopes: [], oauthClientId: null, installation }` and `req.appInstallation = installation`, and answer 403 `Resource not accessible by integration` on `GRAPHQL_PATH`. In `GitBasicAuthMiddleware.resolveKey`, a password matching `INSTALLATION_TOKEN` resolves through `verify` to `{ actor: { userId: botUserId }, apiKeyId: null, scopes: null }` and sets `req.appInstallation`. A bad token is anonymous, as a bad key is today. Every other path leaves `appInstallation` null.
- [ ] **Step 4: Run green.** Both commands PASS; `$E2E test/github-app.e2e-spec.ts test/github-scopes.e2e-spec.ts` still green.
- [ ] **Step 5: Commit** `Mint installation tokens at GitHub's paths`.

### Task 4: Bot access and permission enforcement

**Files:**
- Create: `lib/apps/app-permission.ts`, `lib/git/git-push.ts`, `services/apps/installation-access.service.ts`, `auth/app-permission.guard.ts`
- Modify: `lib/repositories/access/repository-access.ts` (`installationRoleOf`, `Grants.installationRole`, `roleOf`), `services/git/repository-access/repository-access.service.ts` (select it in `lookup` and `explicitRoles`), `services/rulesets/ruleset-verdicts.service.ts` (`actorOf` selects `installationRole: sql\`null\``), `git/middleware/git-basic-auth/git-basic-auth.middleware.ts` (uses `isGitPush`), `app.module.ts` (third `APP_GUARD`, after `RateLimitGuard`), every GitHub-compat and git controller (declarations below)
- Test: `lib/apps/app-permission.spec.ts`, `lib/repositories/access/repository-access.spec.ts` (if present, else beside it), `apps/api/test/app-permissions.e2e-spec.ts` (includes the coverage test)

**Interfaces:**
- Consumes: `AppInstallationCaller`, `IntegrationForbiddenError`, `grants`.
- Produces:
```ts
// lib/apps/app-permission.ts
export type AppPermissionLevel = 'read' | 'write' | ((req: Request) => 'read' | 'write');
export type AppPermissionNeeds = Partial<Record<AppPermission, AppPermissionLevel>>;
export const APP_PERMISSION = 'ghost:app-permission';
/** On a controller or a route. A permission name takes its level from the HTTP method; an object states every need, with levels. A route's declaration replaces its controller's. */
export const RequireAppPermission: (needs: AppPermission | AppPermissionNeeds) => ClassDecorator & MethodDecorator; // SetMetadata
export function neededLevels(needs: AppPermission | AppPermissionNeeds, req: Request): Partial<Record<AppPermission, 'read' | 'write'>>; // GET/HEAD → read, others → write for the name form

// lib/git/git-push.ts
export function isGitPush(req: Request): boolean; // the middleware's current isPush expression, unchanged
export const gitContentsLevel = (req: Request) => (isGitPush(req) ? 'write' : 'read');

// lib/repositories/access/repository-access.ts
export function installationRoleOf(repositoryId: PgColumn, actor: ActorRef): SQL<'write' | null>; // 'write' when a live (app not deleted, not suspended) installation of the app whose bot is the actor covers the repository: the account owns it (user repo: owner_id and no organization; org repo: organization_id) and the selection is 'all' or lists it
Grants.installationRole: CollaboratorRole | null; // roleOf includes it in highestOf on both branches

// services/apps/installation-access.service.ts
@Injectable() export class InstallationAccessService {
  repository(owner: string, repo: string): Promise<{ id: string; visibility: 'public' | 'private'; covered: (caller: AppInstallationCaller) => boolean } | null>;
}
```
**Guard** (`AppPermissionGuard.canActivate`): no `req.appInstallation` → allow. Read the declaration with `Reflector.getAllAndOverride(APP_PERMISSION, [handler, class])`; none → `IntegrationForbiddenError`. With route params naming a repository (`owner ?? username`, `repo` without `.git`): unknown → `RepositoryNotFoundError`; covered by the caller's installation, in `repositoryIds` when that is set, and every needed level granted by the caller's `permissions` → allow; otherwise, a public repository with only `read` levels → set `req.githubViewer = null`, `req.actor = null`, `req.appInstallation = null` and allow (anonymous); a private one not covered → `RepositoryNotFoundError`; else `IntegrationForbiddenError`. With no repository params: allow when every level is granted, else `IntegrationForbiddenError`. On git, the guard's errors become the git answer (404 as today, 403 text).

**Declarations:**

| Controller | Declaration | Route overrides |
|---|---|---|
| `git/git.controller.ts`, `git/lfs.controller.ts`, `git/lfs-locks.controller.ts` | `{ contents: gitContentsLevel }` | none |
| `rest/issues/issues.controller.ts`, `labels.controller.ts`, `comments.controller.ts` | `'issues'` | none |
| `rest/pulls/pulls.controller.ts`, `reviews.controller.ts`, `requested-reviewers.controller.ts`, `review-comments.controller.ts` | `'pull_requests'` | none |
| `rest/statuses/statuses.controller.ts` | `'statuses'` | none |
| `rest/releases/releases.controller.ts`, `uploads.controller.ts` | `'contents'` | none |
| `rest/git/git.controller.ts` (refs delete) | `'contents'` | none |
| `rest/repos/codeowners.controller.ts` | `'contents'` | none |
| `rest/repos/repos.controller.ts` | none | `GET repos/:owner/:repo` → `'metadata'`; `readme`, `zipball`, `tarball` → `'contents'` |
| `rest/rulesets/rulesets.controller.ts` | none | `GET rulesets`, `GET rulesets/:id`, `GET rules/branches/*branch` → `'metadata'` |
| `rest/users/users.controller.ts` | none | `GET users/:login` → `'metadata'` |
| `rest/meta/meta.controller.ts`, `rest/templates/templates.controller.ts` | `'metadata'` | none |

Every other route stays undeclared, which refuses it. The coverage test names each one in `DENIED_TO_INSTALLATIONS`: the JWT routes (`GET /app`, the `/app/installations*` routes and the three `installation` lookups); `/user*`, `user/repos`, `users/:username/repos`, `orgs/:org/repos`, `POST orgs/:org/repos`; `PATCH`/`DELETE repos/:owner/:repo`; rulesets writes and `rule-suites`; `uploads/user-attachments/assets`. `GET /installation/repositories` is declared `'metadata'`.

- [ ] **Step 1: Write the failing tests.**
  - `app-permission.spec.ts`: `neededLevels('issues', { method: 'GET' })` → `{ issues: 'read' }`; `HEAD` → read; `POST`, `PATCH`, `PUT`, `DELETE` → write; `neededLevels({ pull_requests: 'write', contents: 'read' }, GET)` → that object; `neededLevels({ contents: gitContentsLevel }, …)` → `write` for `POST /o/r.git/git-receive-pack`, for `GET info/refs?service=git-receive-pack` and for an LFS batch with `operation: 'upload'`, and `read` for `POST git-upload-pack`.
  - `app-permissions.e2e-spec.ts`. The app has `{ issues: 'write', contents: 'read' }`, installed `selected` `[r1]` (private) on `installer`, who also owns a private `r2` and a public `pub`. `token` is minted with no narrowing.
    - `every route is declared or denied on purpose`: from `app.get(DiscoveryService).getControllers()`, every handler of a controller whose path starts with `v3`, `uploads` or `:username/:repo` either has `APP_PERMISSION` metadata on itself or its class, or its `METHOD PATH` is in `DENIED_TO_INSTALLATIONS`. No entry in the list is declared.
    - `writes where the installation allows`: `POST /repos/{installer}/{r1}/issues` → 201 with `user.login === slug + '[bot]'`, `user.type: 'Bot'`.
    - `refuses a permission it lacks`: `POST /repos/{installer}/{r1}/statuses/{sha}` → 403 `Resource not accessible by integration`; `GET /repos/{installer}/{r1}/pulls` → 403.
    - `hides a private repository outside the installation`: `GET /repos/{installer}/{r2}/issues` → 404.
    - `reads a public repository as anyone can`: `GET /repos/{installer}/{pub}/pulls` → 200 (not installed, no `pull_requests` permission); `POST /repos/{installer}/{pub}/issues` → 403.
    - `refuses an undeclared route`: `GET /user` → 403 `Resource not accessible by integration`; `PATCH /repos/{installer}/{r1}` → 403.
    - `respects a narrowed token`: a token minted with `{ permissions: { issues: 'read' } }` gets 403 on `POST .../{r1}/issues` and 200 on `GET`.
    - `refuses a token on another installation's repository`: the same app installed on `other`'s private `o1`; installer's `token` on `GET /repos/{other}/{o1}/issues` → 404.
    - `loses a repository transferred to another account`: transfer `r1` to `third` (existing transfer route) → `GET /repos/{third}/{r1}/issues` with `token` → 404.
    - `fetches but does not push`: `git clone` with `x-access-token:<token>` of `r1` succeeds; `git push` fails, and the server answered 403 on `info/refs?service=git-receive-pack`; `git clone` of `r2` fails with 404.
    - `refuses an LFS upload batch`: `POST /{installer}/{r1}.git/info/lfs/objects/batch` with `operation: 'upload'` → 403; `download` → 200.
    - `pushes with contents write`: a second app with `contents: 'write'` installed on `r1`; `git push` with its token succeeds and the pushed ref's push event or reflog actor is the bot (`pushedBy` = bot user id).
    - `leaves users alone`: `installer`'s own PAT on every route above answers as it did before this task.
- [ ] **Step 2: Run red.** `npx vitest run src/lib/apps/app-permission.spec.ts` and `$E2E test/app-permissions.e2e-spec.ts`. Expected: FAIL; the writes 404 because the bot has no role yet, and the refusals pass through.
- [ ] **Step 3: Implement** `installationRoleOf` and the grant, `isGitPush` (moved, with its comment), the decorator, `InstallationAccessService`, the guard, and the declarations in the table.
- [ ] **Step 4: Run green.** Both commands PASS. Then `TEST_DATABASE_URL=... npx vitest run src/lib/repositories src/services` and the whole `$E2E` suite, compared with the known failures in memory: `roleOf` changed under every service.
- [ ] **Step 5: Commit** `Enforce app permissions on installation tokens`.

### Task 5: Attribution and the Probot path

**Files:**
- Modify: `resources/commit-statuses/commit-statuses.service.ts` (`create` target takes `installationId?: string`), `github/rest/statuses/statuses.service.ts` (passes `viewer.installation?.installationId`)
- Test: `apps/api/test/app-attribution.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: `commit_status.installation_id` set for installation callers.

- [ ] **Step 1: Write the failing tests** in `app-attribution.e2e-spec.ts`. The app has `{ pull_requests: 'write', statuses: 'write', issues: 'write', contents: 'write' }`, installed on `all` of `installer`'s repositories; `installer` opens a pull request on `r1`. `octokit = await app.getInstallationOctokit(installationId)`.
  - `does what a review bot does` (the slice's done-when): `octokit.rest.pulls.get({ mediaType: { format: 'diff' } })` returns the diff text; `octokit.rest.pulls.createReview({ event: 'COMMENT', body, comments: [{ path, line, body }] })` → review `user.login === botLogin`, and its inline comment lists under `pulls.listReviewComments` with the bot as author; `octokit.rest.repos.createCommitStatus({ sha: head, state: 'success', context: 'ci/bot' })` → `creator.login === botLogin`.
  - `records the installation on a status`: the DB row of that status has `installationId` set; a status `installer` posts with a PAT has `installationId: null`.
  - `attributes every write to the bot`: issue comment, label add, release create and a push through git each carry the bot user as author/actor in the GitHub REST answer (`user.login`, `author.login`, or the push event actor in the repository's events).
  - `is refused outside the installation or the permission`: a token of the same app narrowed to `{ permissions: { pull_requests: 'read' } }` → `createReview` 403; a private repository of another account → 404.
- [ ] **Step 2: Run red.** `$E2E test/app-attribution.e2e-spec.ts`. Expected: the `installationId` assertions fail. Anything else failing is a Task 4 gap: fix it there.
- [ ] **Step 3: Implement** the `installationId` pass-through.
- [ ] **Step 4: Run green.** Same command, PASS; `$E2E test/statuses.e2e-spec.ts` (or the existing statuses suite) still green.
- [ ] **Step 5: Commit** `Attribute statuses to installations`.

### Task 6: Rulesets part C, Integration bypass and bot approvals

**Files:**
- Modify: `lib/rulesets/rulesets.types.ts` (`integration_id`, `BypassActor`, `RulesetActor.appId`, `RefFacts.statuses[].appId`), `lib/rulesets/evaluate-rulesets.ts` (`bypassOf`, `unmetChecks`), `services/rulesets/ruleset-verdicts.service.ts` (`actorOf`, status facts), `resources/pull-requests/pull-requests.service.ts` (`mergeConditions` status facts), `resources/commit-statuses/commit-statuses.service.ts` (`requiredCheckStatuses`), `resources/rulesets/rulesets.service.ts` and its DTO (Ghost API `Integration`), `github/rest/rulesets/{rulesets.service.ts,dto/rulesets.dto.ts}`, `github/graphql/resolvers/repository/repository-nodes.service.ts`, `github/graphql/types/ruleset.type.ts` (drop the "always null" comment), `lib/codeowners/codeowners.ts` (owner regex accepts a `[bot]` suffix)
- Test: `lib/rulesets/evaluate-rulesets.spec.ts`, `lib/codeowners/codeowners.spec.ts`, `apps/api/test/app-rulesets.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 columns; Task 5's `installationId` on statuses.
- Produces:
```ts
// rulesets.types.ts
required_status_checks: { context: string; integration_id?: number /* positive int, an App ID */ }[]
BypassActor gains | { actorType: 'Integration'; appId: string }
RulesetActor gains appId: string | null // the app whose bot is acting, else null
RefFacts.statuses: { context: string; state: CommitStatusState; appId: number | null }[] // newest first, newest per (context, app)

// commit-statuses.service.ts
requiredCheckStatuses(repositoryId: string, shas: string[]): Promise<Map<string, RefFacts['statuses']>>; // DISTINCT ON (sha, context, app numeric id), newest first; replaces the combinedFor calls at ruleset-verdicts.service.ts:238 and pull-requests.service.ts:1036
```
- `unmetChecks`: an unpinned context takes the first status with that context (today's rule); a pinned one takes the first with that context and `appId === integration_id`.
- Saving a check with `integration_id` that names no app → 422 `integration_id <n> does not name an app`; a deleted app's existing pin is kept (it can never be met). The error goes through the existing `GithubValidationError` (REST) and the Ghost API's ruleset validation.
- REST bypass actor: `{ actor_type: 'Integration', actor_id: <App ID>, bypass_mode }`; an unknown App ID → 422 as an unknown team is today.

- [ ] **Step 1: Write the failing tests.**
  - `evaluate-rulesets.spec.ts`:
    - `pins a check to an app`: rule `{ context: 'ci', integration_id: 7 }`; statuses `[{ ci, success, appId: null }, { ci, failure, appId: 7 }]` → unmet; `[{ ci, failure, appId: null }, { ci, success, appId: 7 }]` → met.
    - `leaves an unpinned check as before`: `[{ ci, failure, appId: 7 }, { ci, success, appId: null }]` → unmet (the newest is the failure).
    - `bypasses for the named app`: bypass `{ Integration, appId: 'app_x', always }`, actor `{ role: null, teamIds: [], organizationAdmin: false, appId: 'app_x' }` → `always`; `appId: 'app_y'` → `never`.
  - `codeowners.spec.ts`: `@lint-bot[bot]` parses as a user owner `lint-bot[bot]`.
  - `app-rulesets.e2e-spec.ts`. App `ci` with `statuses: 'write'` installed on `r1`; a ruleset on `r1`'s default branch.
    - `accepts integration_id`: `POST /repos/{o}/{r1}/rulesets` with `required_status_checks: [{ context: 'ci', integration_id: ciAppId }]` → 201 and the GET echoes it; GraphQL `requiredStatusChecks { integrationId }` → `ciAppId`; `integration_id: 999999` → 422.
    - `merges only on the app's status`: `installer` posts `ci: success` with a PAT → merge refused with `Required status check "ci" is expected.`; the app posts `ci: success` → merge allowed.
    - `bypasses for an Integration actor`: a ruleset with `required_linear_history` and bypass `{ actor_type: 'Integration', actor_id: ciAppId }`; a second app installed on `r1` with `contents: write`, and `ci` given `contents: write` too. `ci`'s token pushes a merge commit → accepted; the other app's → refused.
    - `does not bypass by repository role`: bypass `{ actor_type: 'RepositoryRole', actor_id: 4 /* write */ }` → the other app's push is still refused.
    - `counts a bot approval`: a `pull_request` rule with `required_approving_review_count: 1`; an app with `pull_requests: write` approves through `createReview({ event: 'APPROVE' })` → the merge is allowed.
    - `satisfies code owners only when named`: `require_code_owner_review: true`, CODEOWNERS `* @{installer}` → bot approval does not satisfy; CODEOWNERS `* @{slug}[bot]` → it does.
- [ ] **Step 2: Run red.** `npx vitest run src/lib/rulesets src/lib/codeowners` and `$E2E test/app-rulesets.e2e-spec.ts`. Expected: FAIL; `integration_id` is refused by the schema.
- [ ] **Step 3: Implement.** `actorOf` adds `appId: (select id from app where bot_user_id = userId and deleted_at is null)`.
- [ ] **Step 4: Run green.** Both commands PASS; `$E2E test/rulesets*.e2e-spec.ts` still green.
- [ ] **Step 5: Commit** `Pin required checks to apps and let rulesets bypass for an app`.

### Task 7: Web pages, bot badge and docs

**Files:**
- Create: `apps/web/src/components/installations/` (account picker, repository selection, permission summary, installation row with Configure, Suspend and Uninstall), `apps/web/src/app/apps/[slug]/installations/new/{page,loading}.tsx`, `apps/web/src/app/settings/installations/{page,loading,[id]/page}.tsx`, the same under `apps/web/src/app/[username]/settings/installations/`
- Modify: both settings layouts (nav entry "Installed apps", next to "Apps"), `apps/web/src/components/users/user-link.tsx` (a username ending `[bot]` links to `/apps/<slug>` and shows a `bot` badge), the rulesets form (`components/rulesets/`: an optional App ID per required check; an app option in `bypass-actors-field.tsx` that takes an app slug and stores its App ID; a "this app was deleted" flag on a pin naming a deleted app), `apps/web/src/lib/api/v1.d.ts` (regenerate), `apps/docs/content/docs/apps/` (installing, tokens, permissions and what an installation token can call, the `DENIED_TO_INSTALLATIONS` list in plain words)

- [ ] **Step 1:** Regenerate the API types. Reuse `components/apps/` (logo, permission table) and `components/oauth-apps/` pieces by prop before writing new ones (rule 9). The repository picker uses the existing repository list endpoints of the chosen account.
- [ ] **Step 2:** Install page: account picker (you and the orgs you admin; an account that already has the app links to its Configure page instead), All or Selected repositories, the permission summary from the app, Install. On success, `router.push(redirectUrl)` for a same-origin path, `window.location.assign` otherwise.
- [ ] **Step 3:** Installed-apps settings: one row per installation with the app logo, name, `suspended` state and Configure, Suspend/Unsuspend and Uninstall (uninstall in a confirmation dialog, as the delete cards do). Configure edits the repository selection and shows the accepted permissions.
- [ ] **Step 4:** Bot badge in `UserLink` and anywhere else that renders a login without `UserLink` on issue, pull request, review, comment, status and release views (grep for `.username` and `login` in those components).
- [ ] **Step 5:** Rulesets form fields and docs.
- [ ] **Step 6:** Run the web app against the e2e-free dev setup the user runs. If their dev server holds `:3000`, ask them to check the install flow and settings pages instead of starting a second one. `bun run lint` and `bun run typecheck` in `apps/web`.
- [ ] **Step 7: Commit** `Install page, installed-apps settings, bot badge and docs`.

---

**Done when (issue #104):** Task 5's `does what a review bot does` and Task 4's refusals pass, and Task 6's `merges only on the app's status` passes. Then the full `$E2E` suite matches the known-failure list, and the PRs open on both remotes (Ghost: `Closes #104`).
