# Ghost Apps 5: User-to-Server Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Who does what:** Claude implements all of this slice, backend and frontend, test-first (user decision, 2026-10-30). Every task writes its tests, runs them red, implements, and runs them green.

**Goal:** Every Ghost App can sign Ghost users in, the way a GitHub App does. Its website gets `ghu_`/`ghr_` tokens that act as the user, limited to what both the app and the user may do, on repositories the app is installed on. The work is labelled "via app" and can be listed, checked and revoked.

**Architecture:**
- **One OAuth path for both kinds of app.** Each Ghost App gets an `oauth_client` row from the oauth-provider plugin, linked by `app.oauth_client_id`. It is registered as a public client (`token_endpoint_auth_method: 'none'`, `require_pkce: false`). `/login/oauth/authorize`, `/login/device/code` and `/login/oauth/access_token` then serve Ghost Apps with no new routes.
  - Ghost checks the app's own client secrets (`app_client_secret`, sha256) before it calls the plugin.
  - `findOauthApp` gains `ghostAppId`, and `OauthService.mint` mints a `ghu_` token instead of an API key when it is set.
- **Tokens:** `app_user_token` stores the sha256 of each `ghu_` token, with its app, user and expiry. Refresh tokens reuse `oauth_app_refresh_token` keyed to the app's client id, with `accessKeyId` holding the `app_user_token` id and a `ghr_` prefix.
- **Access:**
  - `GithubAuthMiddleware` and `GitBasicAuthMiddleware` recognise `ghu_` and set the viewer to the user. They also set `req.userToServer = { appId, tokenId }` and run the request in the `userToServerCaller` AsyncLocalStorage.
  - `AppPermissionGuard` gains a user-to-server branch. The route must declare a permission, a live installation of the app must cover the repository, and that installation's accepted permissions must grant the need.
  - The user's own role still comes from the services' usual checks, so the result is the intersection of the two.
- **Attribution:** `via_app_id` on `issue`, `issue_comment`, `pull_request_review`, `pull_request_review_comment` and `commit_status`, set from `userToServerCaller` at each insert.

**Tech Stack:** NestJS 11, Drizzle, Better Auth oauth-provider and deviceAuthorization plugins, `node:crypto`, vitest + supertest, `@octokit/oauth-app` / `@octokit/auth-oauth-user` (dev-only, for compatibility tests, if not already present), Next.js.

**Spec:** `docs/superpowers/specs/2026-10-25-ghost-apps-design.md`. Read "Slice 5" and "Slice 5 decisions". "Slice 5 decisions" wins where the two differ.

**Branch:** `feat/ghost-apps-5`, cut from `main` at a865807. It already holds the spec commits f2cf5a8 and e3cf266.

## Global Constraints

- Copy GitHub wherever the spec is silent (user decision).
- `ghu_` + 36 `[A-Za-z0-9]` from `randomInt`, lasting 8 hours (`ACCESS_TOKEN_EXPIRES_IN` 28800). `ghr_` + 76 `[A-Za-z0-9]`, lasting 6 months (`REFRESH_TOKEN_EXPIRES_IN`). Only sha256 hex is stored.
- With "Expire user authorization tokens" off, a token has no expiry and the reply has no `refresh_token`. The switch is on by default for new apps. "Enable Device Flow" is off by default.
- The token reply carries `scope: ""` whatever was asked for.
- Client secrets: at most 20 per app, each shown once, then identified by its last 8 characters. `422 "An app can have at most 20 client secrets"`.
- Callback URLs: at most 10. `422 "An app can have at most 10 callback URLs"`.
- Refusals for a user-to-server caller: `403 "Resource not accessible by integration"`, or 404 for a private repository the caller cannot reach. These are the slice 2 messages.
- `ghu_` works on the GitHub-compatible REST layer and git over HTTPS only. Ghost's own API answers 401, and GraphQL answers 403 `Resource not accessible by integration`, until slice 6.
- `/applications/{client_id}/...` is authenticated with HTTP Basic: the client id as username, one of the app's client secrets as password. Anything else answers 404 `Not Found`, as GitHub does for a wrong pair.
- Reset (`PATCH /applications/{client_id}/token`) and scoped tokens (`POST .../token/scoped`) are slice 6. They stay unrouted and answer 404.
- Code standards (`docs/code-standards.md`). Migrations come from `bun db:generate`, never hand-edited.
- Integration specs run against a throwaway Postgres (`$INT`), and e2e against throwaway Postgres, rustfs and Redis (`$E2E`). The recipe is in the slice 3 plan.

## Review Focus

1. **The user cannot see a private repository the app is installed on.** The `ghu_` token must answer 404 there, though the guard's installation check passes. Test in Task 3 (`does not reach a private repository the user cannot see`).
2. **The app's expiry switch turned off after tokens were issued.** The next refresh mints a token that never expires, with no refresh token. This is the OAuth app behaviour from PR #110. Test in Task 2 (`a refresh after expiry is turned off returns a token that never expires`).
3. **One app's client credentials used on another app's token.** Check and revoke answer 404 and leave the token working. Test in Task 4 (`refuses another app's token`).
4. **The app is deleted, or the user revokes it.** Its `ghu_` tokens answer 401 at once, and its `ghr_` tokens answer `bad_refresh_token`. Tests in Tasks 3 and 4.
5. **A status posted with a `ghu_` token.** It never satisfies a ruleset check pinned to the app, even when it carries the right context. Test in Task 5 (`a user-to-server status does not satisfy a pinned check`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/db/src/schema/apps.ts` | `app.oauthClientId`, `app.requestOauthOnInstall`; `app_client_secret`; `app_user_token` |
| `packages/db/src/schema/{issues,pull-requests,commit-statuses}.ts` | `viaAppId` columns |
| `apps/api/src/lib/apps/user-token.ts` | `USER_TOKEN`, `generateUserToken`, `generateUserRefreshToken`, `hashUserToken` (pure) |
| `apps/api/src/lib/apps/user-token-context.ts` | `userToServerCaller` AsyncLocalStorage, `UserToServerCaller` type |
| `apps/api/src/lib/github/refresh-tokens.ts` | `issueRefreshToken` takes the token to store |
| `apps/api/src/lib/github/oauth-apps.ts` | `OauthApp.ghostAppId` |
| `apps/api/src/services/apps/app-clients.service.ts` | Creates the app's `oauth_client`, client secrets, Basic-auth check |
| `apps/api/src/services/apps/user-tokens.service.ts` | Mint, verify, revoke `ghu_` tokens |
| `apps/api/src/github/oauth/oauth.service.ts` | Ghost App branch in secret check, mint and refresh |
| `apps/api/src/github/auth/github-auth.middleware.ts`, `git/middleware/git-basic-auth/*` | Recognise `ghu_` |
| `apps/api/src/auth/app-permission.guard.ts` | User-to-server branch |
| `apps/api/src/github/rest/app/user-installations.controller.ts` | `GET /user/installations[/:id/repositories]` |
| `apps/api/src/github/rest/app/applications.controller.ts` | `POST/DELETE /applications/:client_id/token`, `DELETE .../grant` |
| `apps/api/src/resources/apps/*` | Client secrets, callback URLs, switches |
| `apps/api/src/resources/oauth-apps/oauth-apps.service.ts` | Authorized apps include Ghost Apps |
| `apps/web/src/components/apps/*`, `components/users/user-link.tsx`, authorized-apps page | Settings, "via" label |

---

### Task 1: Each app gets a client: schema, client secrets, settings

**Files:**
- Modify: `packages/db/src/schema/apps.ts` and the generated migration
- Create: `apps/api/src/services/apps/app-clients.service.ts`
- Modify: `apps/api/src/resources/apps/{apps.service.ts,apps.controller.ts,dto/app.dto.ts,apps.module.ts}`, `apps/api/src/lib/apps/{apps.errors.ts,delete-apps.ts}`
- Test: `apps/api/test/apps.e2e-spec.ts`

**Interfaces:**
- Produces:
  - Schema:
    - `app.oauthClientId: text references oauth_client.client_id unique, nullable`
    - `app.requestOauthOnInstall: boolean default false`
    - `app_client_secret(id 'acs_', appId cascade, secretHash unique, lastEight, createdAt)`
    - `app_user_token(id 'aut_', tokenHash unique, appId cascade, userId cascade, expiresAt nullable, createdAt)`, indexed on `(appId, userId)`
    - `viaAppId: text references app.id on delete set null` on `issue`, `issue_comment`, `pull_request_review`, `pull_request_review_comment` and `commit_status`
    All in one migration.
  - `AppClientsService.clientOf(appId: string): Promise<string>`: the app's client id, creating the public `oauth_client` row on first call. Its name, URI, callbacks, `metadata.appId`, `metadata.expireUserTokens` and `metadata.deviceFlow` come from the app.
  - `AppClientsService.authenticate(clientId: string, secret: string): Promise<{ appId: string } | null>`.
  - `AppClientsService.createSecret(appId) → { id, clientSecret, lastEight, createdAt }` and `removeSecret(appId, id)`.
  - `AppDTO` gains `clientId`, `callbackUrls`, `expireUserTokens`, `deviceFlowEnabled`, `requestOauthOnInstall` and `clientSecrets: { id, lastEight, createdAt }[]`. Create and update DTOs take the first five, except `clientId`.
  - Routes: `POST /apps/:slug/client-secrets` → 201 `{ id, clientSecret, lastEight, createdAt }`, and `DELETE /apps/:slug/client-secrets/:id` → 204. Owner only, 404 for anyone else.
  - Client secret format: `ghost_cs_` + 40 hex.

- [ ] **Step 1: Write the failing tests** in `apps.e2e-spec.ts` (`describe('user authorization settings')`):
  - `gives a new app a client id, expiring tokens on and device flow off`. Register, then expect `clientId` to be a string and `expireUserTokens: true`, `deviceFlowEnabled: false`, `requestOauthOnInstall: false`, `callbackUrls: []`, `clientSecrets: []`. The `oauth_client` row exists, with `metadata.appId` equal to the app id.
  - `creates a client secret once, then shows only its last eight characters`.
  - `caps client secrets at 20` (the 21st gives a 422 with the exact message) and `caps callback URLs at 10`.
  - `refuses requestOauthOnInstall without a callback URL` (422 `"Add a callback URL before asking for user authorization during installation"`).
  - `keeps the client in step`: a rename, new callbacks or flipped switches show on the `oauth_client` row.
  - `deleting an app deletes its client, secrets and user tokens`.
  - `hides client secrets from anyone but the owner` (404).
- [ ] **Step 2: Run red.** `$E2E test/apps.e2e-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Schema first, then `bun db:generate`.
  - `AppClientsService` creates the row with `adminCreateOAuthClient`: `token_endpoint_auth_method: 'none'`, `require_pkce: false`, `grant_types: ['authorization_code']`. Then it sets `metadata` with the merge `OauthAppsService.setGhostFields` uses, moved to a shared function under `lib/github/oauth-apps.ts`.
  - Existing apps get their client lazily through `clientOf` (spec: either way is fine).
  - `deleteApps` deletes the client rows of the deleted apps.
- [ ] **Step 4: Run green.** Same command, PASS. `$E2E test/oauth-apps.e2e-spec.ts` stays green.
- [ ] **Step 5: Commit.** "Give every Ghost App an OAuth client, client secrets and user authorization settings"

### Task 2: `ghu_`/`ghr_` tokens from the web flow, device flow and refresh

**Files:**
- Create: `apps/api/src/lib/apps/user-token.ts` (+ `user-token.spec.ts`), `apps/api/src/services/apps/user-tokens.service.ts`
- Modify: `apps/api/src/lib/github/{oauth-apps.ts,refresh-tokens.ts}`, `apps/api/src/github/oauth/oauth.service.ts`
- Test: `apps/api/test/github-app-user-tokens.e2e-spec.ts`. Copy the authorize→consent→code helpers from `github-oauth-web.e2e-spec.ts` and the device helpers from `github-oauth.e2e-spec.ts`.

**Interfaces:**
- Consumes: Task 1's `clientOf`, `authenticate`, `app_user_token`.
- Produces:
  - `USER_TOKEN = /^ghu_[A-Za-z0-9]{36}$/`, `generateUserToken()`, `generateUserRefreshToken()`, `hashUserToken(token)`.
  - `UserTokensService.mint(executor, { appId, userId, expires: boolean }) → { id, token, expiresAt: Date | null }`.
  - `UserTokensService.verify(token) → UserToServerCaller | null`. It is null when the token is unknown, expired, or its app is deleted.
  - `type UserToServerCaller = { tokenId: string; appId: string; userId: string }`, in `lib/apps/user-token-context.ts`.
  - `issueRefreshToken(db, clientId, grant, token = newRefreshToken())`.
  - `OauthApp.ghostAppId: string | null`, from `oauth_client.metadata->>'appId'`.

- [ ] **Step 1: Write the failing tests.**
  - Unit (`user-token.spec.ts`): the formats and lengths of both tokens, and that the hash is 64-character hex.
  - E2E:
    - `the web flow returns a ghu_ token and a ghr_ refresh token with empty scope`. Assert the body is `{ access_token: /^ghu_/, token_type: 'bearer', scope: '', expires_in: 28800, refresh_token: /^ghr_/, refresh_token_expires_in: 15897600 }`, and that `scope=repo` in the authorize request changes nothing.
    - `refuses a wrong client secret` (`incorrect_client_credentials`) and `accepts any of the app's secrets`.
    - `the device flow works when enabled and answers unauthorized_client when not`.
    - `a refresh spends the ghr_ token, revokes the old ghu_ and returns a new pair`.
    - `a refresh after expiry is turned off returns a token that never expires` (Review Focus 2).
    - `with expiry off, the token has no expires_in or refresh_token`.
    - `a ghu_ token answers GET /api/v3/user as the user` (this needs Task 3's middleware; mark `it.todo` here, and Task 3 turns it on).
- [ ] **Step 2: Run red.** `npx vitest run src/lib/apps/user-token.spec.ts` and `$E2E test/github-app-user-tokens.e2e-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `OauthService`, when `app.ghostAppId` is set:
  - `codeGrant` and `refreshGrant` check `body.client_secret` with `AppClientsService.authenticate` first, then call the plugin without a secret.
  - `mint` calls `UserTokensService.mint` and `issueRefreshToken(..., generateUserRefreshToken())`.
  - `refreshGrant` deletes the old `app_user_token` row instead of the API key.

  If the plugin refuses a public client without PKCE, rule the smallest fallback (a confidential client whose plugin secret is kept sealed with `sealWebhookSecret`) and ledger it.
- [ ] **Step 4: Run green.** Same commands, PASS. `$E2E test/github-oauth.e2e-spec.ts test/github-oauth-web.e2e-spec.ts test/github-oauth-refresh.e2e-spec.ts` stays green.
- [ ] **Step 5: Commit.** "Mint ghu_ and ghr_ tokens for Ghost Apps through the OAuth flows"

### Task 3: What a `ghu_` token may reach

**Files:**
- Create: `apps/api/src/lib/apps/user-token-context.ts`
- Modify: `apps/api/src/github/auth/{github-auth.middleware.ts,github-request.ts}`, `apps/api/src/git/middleware/git-basic-auth/git-basic-auth.middleware.ts`, `apps/api/src/auth/app-permission.guard.ts`, `apps/api/src/services/apps/installation-access.service.ts`, `apps/api/src/auth/api-key-auth.guard.ts` (refuse `ghu_` on Ghost's own API)
- Test: `apps/api/test/app-user-permissions.e2e-spec.ts`

**Interfaces:**
- Consumes: `UserTokensService.verify`, `installationCovers`, `grants`.
- Produces:
  - `userToServerCaller: AsyncLocalStorage<UserToServerCaller>`.
  - `GithubRequest.userToServer?: UserToServerCaller | null`.
  - `InstallationAccessService.acceptedFor(appId, repositoryId) → AppPermissions | null`: the accepted permissions of the live installation of `appId` that covers the repository.

- [ ] **Step 1: Write the failing tests.** Use an app with `issues: write` and `contents: read`, installed on `alice`'s account with selected repository `r1`. `bob` is a collaborator on `r1` with `read`.
  - `alice's token reads and writes issues on r1`, and `is refused contents write on r1 (403)`.
  - `bob's token reads r1 issues but cannot open one (his role)`.
  - `does not reach a private repository the user cannot see` (Review Focus 1). `carol`'s token on `r1` gets 404.
  - `answers 404 on alice's private r2 outside the installation`, and `reads a public repository outside it as the user`.
  - `loses access when the app is uninstalled or the installation suspended, then regains it when unsuspended`.
  - `reads /user without any installation`.
  - `stops at once when the app is deleted` (401, Review Focus 4).
  - `is refused on Ghost's own API (401) and on GraphQL (403)`.
  - `clones r1 over git with the token as password and is refused a push without contents write`.
  - Turn Task 2's `it.todo` into a real test.
- [ ] **Step 2: Run red.** `$E2E test/app-user-permissions.e2e-spec.ts test/github-app-user-tokens.e2e-spec.ts`. Expected: FAIL (401 Bad credentials).
- [ ] **Step 3: Implement.**
  - The middleware recognises `USER_TOKEN` before API keys. Its viewer is `{ userId, scopes: KNOWN_SCOPES, oauthClientId: null }`: the guard, not scopes, limits it.
  - The guard's user-to-server branch has the same shape as the installation branch. `requesterId` is the user, and `covered` and permissions come from `acceptedFor`. A route with no repository passes when it declares nothing beyond `metadata`, or when it is one of the `/user` routes.
  - Run `next` inside `userToServerCaller`.
- [ ] **Step 4: Run green.** Same command, PASS. `$E2E test/app-permissions.e2e-spec.ts test/github-scopes.e2e-spec.ts` stays green.
- [ ] **Step 5: Commit.** "Limit ghu_ tokens to what both the app and the user may do"

### Task 4: `/user/installations`, checking and revoking

**Files:**
- Create: `apps/api/src/github/rest/app/{user-installations.controller.ts,applications.controller.ts}` and their services/DTOs, following `installations.controller.ts`
- Modify: `apps/api/src/resources/oauth-apps/oauth-apps.service.ts` (`listAuthorized`, `revokeAuthorized`), `apps/api/src/services/apps/user-tokens.service.ts`
- Test: `apps/api/test/github-app-user-tokens.e2e-spec.ts`, `apps/api/test/oauth-app-access.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `GET /api/v3/user/installations` → `{ total_count, installations: [GitHub installation object] }`.
  - `GET /api/v3/user/installations/:installation_id/repositories` → `{ total_count, repository_selection, repositories: [GitHub repository] }`.

    Both answer only `ghu_` tokens. Anyone else gets 403 `"You must authenticate with an access token authorized to a GitHub App in order to list installations"`, GitHub's text; verify it while building.
  - `POST /api/v3/applications/:client_id/token` with body `{ access_token }` → 200 with GitHub's authorization shape: `id`, `token: <the token>`, `token_last_eight`, `user`, `app: { client_id, name, url }`, `expires_at`, `scopes: []`, `created_at`, `updated_at`.
  - `DELETE /api/v3/applications/:client_id/token` → 204, and `DELETE .../grant` → 204. The grant delete removes every `ghu_` and `ghr_` the user holds for that app.
  - `UserTokensService.revokeUser(appId, userId)` and `revokeToken(appId, token)`.

- [ ] **Step 1: Write the failing tests.**
  - `lists the installations the user can access`: their own account, an org where they can see a covered repository, and not an org installation whose repositories they cannot see.
  - `lists the installation's repositories the user can see`.
  - `refuses /user/installations to a session or a plain PAT`.
  - `checks a token with the app's credentials`.
  - `refuses another app's token` (404, Review Focus 3), `refuses bad Basic credentials` (404), and `the token keeps working after a refused check`.
  - `revokes one token`.
  - `revoking the grant kills every token and refresh token of that user for the app` (Review Focus 4).
  - `oauth-app-access.e2e-spec.ts`: `Authorized apps lists a Ghost App and revoking it kills its ghu_ and ghr_ tokens`.
- [ ] **Step 2: Run red.** `$E2E test/github-app-user-tokens.e2e-spec.ts test/oauth-app-access.e2e-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Basic auth goes through `AppClientsService.authenticate(clientId, password)`. Add the paths to the GitHub-compat conformance list where installation routes are listed (spec constraint).
- [ ] **Step 4: Run green.** Same command, PASS.
- [ ] **Step 5: Commit.** "List a user's installations, and check and revoke user-to-server tokens"

### Task 5: "via app" attribution

**Files:**
- Modify: `apps/api/src/resources/issues/issues.service.ts`, `apps/api/src/resources/pull-requests/reviews.service.ts`, `apps/api/src/resources/commit-statuses/commit-statuses.service.ts`, the native DTOs/selects for issues, comments, reviews, review comments and statuses, and the GitHub REST serializers for issues and issue comments (`performed_via_github_app`)
- Test: `apps/api/test/app-attribution.e2e-spec.ts`, `apps/api/test/app-rulesets.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `viaApp: { slug: string; name: string; logoUrl: string | null } | null` on the native issue, comment, review, review comment and status DTOs.
  - `performed_via_github_app: GitHub app object | null` on REST issues and issue comments.
  - Every insert into the five tables sets `viaAppId: userToServerCaller.getStore()?.appId ?? null`.

- [ ] **Step 1: Write the failing tests.**
  - `an issue, a comment, a review, a line comment and a status made with a ghu_ token belong to the user and carry viaApp`.
  - `REST shows performed_via_github_app on the issue and comment`.
  - `the same made with a PAT carry viaApp null`.
  - `deleting the app keeps the rows and nulls viaApp`.
  - `app-rulesets.e2e-spec.ts`: `a user-to-server status does not satisfy a pinned check` (Review Focus 5).
- [ ] **Step 2: Run red.** `$E2E test/app-attribution.e2e-spec.ts test/app-rulesets.e2e-spec.ts`. Expected: FAIL on `viaApp`. The ruleset test may pass already; if so, it pins existing behaviour, so ledger that.
- [ ] **Step 3: Implement.** Set `viaAppId` at the eight insert sites (`issues.service.ts` ×2, `reviews.service.ts` ×8 across both tables, `commit-statuses.service.ts` ×1). The importer's inserts stay null. Join `app` in the selects.
- [ ] **Step 4: Run green.** Same command, PASS. `$E2E test/github-rest-issues.e2e-spec.ts test/pull-request-reviews.e2e-spec.ts test/github-statuses.e2e-spec.ts` stays green.
- [ ] **Step 5: Commit.** "Record and show the app a user-to-server token acted through"

### Task 6: User authorization during installation

**Files:**
- Modify: `apps/api/src/resources/installations/installations.service.ts` (`redirectUrl`)
- Test: `apps/api/test/apps-installations.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1's `requestOauthOnInstall`, `clientOf` and callback URLs.
- Produces: when `requestOauthOnInstall` is on, `InstallationDTO.redirectUrl` is `${api}/login/oauth/authorize?client_id=<clientId>&redirect_uri=<first callback with installation_id=<numericId>&setup_action=install appended>`. Otherwise it is today's setup-URL or settings redirect. `callbackMatches` must accept the appended query; check `lib/github/callback.ts`, and widen it only to ignore a query the registered callback lacks, as GitHub does.

- [ ] **Step 1: Write the failing tests.**
  - `asks the installer to authorize the app when requestOauthOnInstall is on`: parse `redirectUrl` and assert the client id, and that the redirect URI carries `installation_id` and `setup_action=install`.
  - `the web flow from there ends at the callback with code, installation_id and setup_action`.
  - `falls back to the setup URL when the switch is off`.
- [ ] **Step 2: Run red.** `$E2E test/apps-installations.e2e-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.** Same command, PASS. `$E2E test/github-oauth-web.e2e-spec.ts` stays green, since `callbackMatches` changed under it.
- [ ] **Step 5: Commit.** "Ask the installer to authorize an app that requests it during installation"

### Task 7: Web

**Files:**
- Modify: `apps/web/src/components/apps/{app-fields.tsx,app-detail.tsx,actions.ts}` and create `app-client-secrets.tsx` (shaped like `app-private-keys.tsx`)
- Modify: `apps/web/src/components/users/user-link.tsx` (`via?: { slug: string; name: string }` renders "via <name>", linking to `/apps/<slug>`), plus the issue, comment, review and status components that render an author
- Modify: `apps/web/src/app/settings/authorized-apps/*` (Ghost Apps listed alongside OAuth apps)

- [ ] **Step 1: Check types red** after regenerating OpenAPI against the throwaway DB.
- [ ] **Step 2: Implement.**
  - The Identity card gains a Client ID field (`CopyField`, with the description "What Octokit calls clientId; sign users in with it").
  - The form gets a "User authorization" fieldset: callback URLs (one per line, up to 10), "Expire user authorization tokens", "Enable Device Flow", and "Request user authorization (OAuth) during installation" (disabled until there is a callback URL).
  - A "Client secrets" card with Generate and Delete. A new secret shows once, with a copy button.
- [ ] **Step 3: Verify.** `bun run check-types` and eslint on the touched files. Then check in Chrome on localhost:3000 (memory: the user's logged-in session; ask before running migrations on the dev DB):
  - create a test app and see its client id
  - generate a secret
  - add a callback
  - run the web flow against a local callback (an `http://localhost:<port>` page that shows the query string)
  - post a comment with the token and see "via <app>"
  - revoke from Authorized apps
  - delete the test app.
- [ ] **Step 4: Commit.** "User authorization settings, client secrets and the via label on the web"

### Task 8: Finish

- [ ] **Step 1:** Run every verification: `bun check-types`; `bun run lint`, comparing against the failures that predate the branch; `$INT src`; the whole `$E2E` suite, comparing with the known failures in memory.
- [ ] **Step 2:** Run the final whole-branch review. Then push to both remotes and open Ghost PR "Closes #106" and GitHub PR "Part of #109" (dual-PR workflow). The PR notes the new migration, which is still to run on dev and prod.
