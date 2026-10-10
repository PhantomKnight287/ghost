# 0040 — GitHub compatibility is a translation layer on the API host

**Status:** adopted

## Decision

`apps/api/src/github/` serves GitHub's GraphQL API at `/api/graphql` and GitHub's REST v3 at `/api/v3`, on the API host. Users point the GitHub CLI at it with `GH_HOST=api.<domain>`. Every resolver and controller calls the existing Ghost services, so permissions, numbering, events and notifications stay where they are.

Pure helpers live in `apps/api/src/lib/github/`, and only `src/github/` imports them. `to<GitHubType>` mappers are allowed there and nowhere else. Each one is a last resort and carries a one-line comment saying why a query could not select GitHub's shape directly.

The GraphQL schema is code-first, generated to `apps/api/github.schema.gql` and committed. A test checks every type, field, argument and enum value in it against `@octokit/graphql-schema`, GitHub's published schema.

Node ids are `<GitHub prefix>_<base64url(Ghost id)>`: `U_`, `O_`, `R_`, `I_`, `PR_`, `IC_`, `LA_`.

`/api/v3/meta` reports GitHub Enterprise Server `3.17.0`. Introspection and GraphiQL are on in every environment. The REST routes appear in the OpenAPI document under the `GitHub compatibility` tag.

## Why

`gh` treats any host other than github.com as GitHub Enterprise Server and calls `https://HOST/api/v3/` and `https://HOST/api/graphql`. The API host already serves `/api` and the git transport, so `gh repo clone` and git credentials resolve against the same host.

Code-first types with a conformance test catch a misspelled field or a wrong nullability in CI, before `gh` hits it.

Version 3.17.0 keeps `gh` on the classic `search(type: ISSUE)` syntax, which Ghost can translate onto its own issue filters.

Rejected:

- Hand-written SDL: easy to get wrong, and it drifts from the resolvers.
- Loading GitHub's full schema at runtime: about 70,000 lines of fields nothing resolves.
- A separate service: the translation needs nearly every Ghost service.

## Consequences

- `databaseId` and the REST `id` are null. Ghost ids are text, and GitHub declares both nullable.
- Milestones, reactions, issue types, projects and sub-issues answer empty. They exist only so `gh`'s fixed queries validate.
- Ghost features without a GitHub equivalent are not exposed.
- `apps/docs/content/docs/github-compatibility.mdx` lists every known difference.
- Keys carry real GitHub scopes. See the addendum below.

## Addendum: scopes and the device flow

API keys store GitHub scopes in `permissions.scopes`. A key without them, made in Ghost's settings, and a browser session hold every scope. `X-OAuth-Scopes` reports what the key holds.

One function, `hasScope` in `apps/api/src/lib/github/scopes.ts`, decides whether granted scopes cover a need, with GitHub's implications (`repo` covers `public_repo`, `admin:org` covers `write:org` and `read:org`, and so on). The compat GraphQL and REST APIs and the git transport all call it. Writes need `repo`, or `public_repo` on a public repository. A private repository needs `repo`, and answers as missing without it, so a token cannot learn that it exists.

`gh auth login --web` and `gh auth refresh` use GitHub's OAuth device flow. Better Auth's `deviceAuthorization` plugin runs it. `apps/api/src/github/oauth/` serves it at GitHub's paths on the API host root, `/login/device/code` and `/login/oauth/access_token`, in GitHub's wire format. The approval page is `<web>/device`.

On approval `gh` receives a `ghost_pat_` API key named `GitHub CLI`, holding the requested scopes Ghost knows. The session the plugin creates is deleted at once. API keys never authenticate Ghost's own `/api`, only the compat layer and git.

Rejected:

- Handing out the plugin's Better Auth session: it is a full browser session, valid for every Ghost API.
- A separate OAuth token table: API keys already verify, rate-limit and revoke, and show in the settings page.

## Addendum: OAuth apps and the web flow

`@better-auth/oauth-provider` holds the app registry in `oauth_client`, with the jwt plugin it needs. `gh`, client id `178c6fc778ccc68e1d6a`, is a built-in app: no owner, no secret, device flow on. `seedBuiltInRows` in `packages/db/src/seed.ts` inserts it from code after migrating (the deploy migrator, the e2e setup, and `seed-github-cli-app` for a database migrated with drizzle-kit), not a migration. Users register their own apps through `/api/oauth-apps`; the service writes through the plugin so secrets are hashed its way, and refuses to change a built-in app. An app's device-flow switch is `oauth_client.metadata.deviceFlow`, which the device flow's `validateClient` reads.

Organizations own apps too, registered through `/api/organizations/:slug/oauth-apps` by its admins and owners, and then managed at `/api/oauth-apps/:clientId` like a user's. An organization's app has the organization's id in the plugin's `oauth_client.referenceId` and no `userId`. The plugin fills `referenceId` from its `clientReference` hook, and only lets a call whose `clientReference` matches change the app. The hook reads `oauthAppOrganization`, an `AsyncLocalStorage` in `apps/api/src/lib/github/oauth-apps.ts`: the service runs each plugin call for an organization's app inside it, after checking that the user administers that organization. Outside it the hook returns nothing, and apps belong to users. A built-in app is one with neither `userId` nor `referenceId`. `referenceId` has no foreign key, so `afterDeleteOrganization` deletes the organization's apps and the keys they minted, and `onOrganizationDeleted` removes their logos.

`oauth_client.metadata.verified` marks an app the instance vouches for, shown as a badge on the approval page. Only an operator sets it, in the database or the seed; no API writes it. The seed sets it on `gh`, and adds it to an existing `gh` row without touching its other fields.

Every plugin route is blocked over HTTP through `disabledPaths` except `/oauth2/authorize`, `/oauth2/consent` and `/oauth2/continue`, which a browser must reach. Ghost calls the rest server-side through `auth.api`. The OIDC routes (`userinfo`, `register`, `end-session`, discovery) stay blocked until Ghost offers "Sign in with Ghost".

`GET /login/oauth/authorize` checks the app and GitHub's callback rule (same scheme, host and port, a path equal to the callback's or under it) before anything redirects, then hands the request to the plugin, which checks the session and the stored consent and sends the user to `<web>/login/oauth/authorize`. The plugin reads an empty `scope` as every scope, so a request with no known scope asks for the sentinel scope `public`, which `grantableScopes` drops.

`POST /login/oauth/access_token` treats a request with a `code` as the code exchange, since GitHub's clients send no `grant_type`. The plugin checks the secret, the code, its `redirect_uri` and PKCE. Ghost reads the token's user through introspection, revokes the token, and mints a `ghost_pat_` key named after the app with `metadata.oauthClientId`, exactly as for the device flow. Revoking an authorized app deletes the user's keys whose `metadata.oauthClientId` names it, and their consent row.

Rejected:

- A Ghost-owned registry (two tables, PKCE as one hash compare): smaller, but the plugin is kept so Ghost can later act as an OIDC provider without a second migration.
- Handing out the plugin's access tokens: they authenticate nothing in the compat layer, and would be a second token type beside API keys.

## Addendum: expiring user tokens and refresh tokens

An OAuth app can turn on GitHub's "Expire user authorization tokens", stored as `oauth_client.metadata.expireUserTokens`. Its grants then mint a `ghost_pat_` key with an 8-hour expiry, which the api-key plugin enforces, and a `ghost_rt_` refresh token that lasts 6 months. `POST /login/oauth/access_token` with `grant_type=refresh_token` checks the client's secret through the plugin's introspection endpoint, spends the refresh token, deletes the old key and mints a new pair under the app's current switch. `gh`'s built-in app cannot be edited, so it never gets expiring tokens.

Refresh tokens live in `oauth_app_refresh_token`, a Ghost table holding each token's sha256. Its `access_key_id` has no foreign key: the api-key plugin deletes expired keys on its own, and a cascade would take the refresh token with them. For the same reason, Authorized apps lists an app when the user holds a key or an unexpired refresh token for it, and revoking deletes both. A refresh and a revoke of the same user's grant take one advisory lock, so a revoke never misses a pair a refresh is minting.

Rejected:

- The plugin's `oauth_refresh_token` table: its rows belong to the plugin's access tokens and sessions, which Ghost revokes right after the code exchange.
- Refresh tokens as API keys with another prefix: the token guard would accept them as access tokens unless every check filtered them out.
- Re-hashing client secrets in Ghost to check them: the plugin owns the hashing, so Ghost asks the plugin.
