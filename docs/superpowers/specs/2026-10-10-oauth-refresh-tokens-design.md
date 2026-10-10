# Expiring OAuth tokens and refresh tokens

Follows the OAuth apps work for [#57](https://github.com/PhantomKnight287/ghost/issues/57) (plan 3, PR #104). Related: Ghost Apps ([#109](https://github.com/PhantomKnight287/ghost/issues/109)), which will reuse the same token pair for user-to-server tokens.

## Goal

An OAuth app can opt into expiring access tokens. Its users then get an access token that lasts 8 hours and a refresh token that lasts 6 months, and the app trades the refresh token for a new pair when the access token runs out. The wire format is GitHub's, for GitHub Apps with "Expire user authorization tokens" on, so clients written for GitHub refresh against Ghost unchanged.

Apps that do not opt in, `gh` among them, keep tokens that never expire, as GitHub OAuth apps do.

## Decisions

- Opt-in per app, off by default. The switch is named "Expire user authorization tokens", GitHub's wording.
- Lifetimes are GitHub's and fixed: access token `28800` seconds, refresh token `15897600` seconds. No configuration.
- `gh`'s built-in app cannot be edited, so it never turns the switch on.
- Turning the switch off changes only tokens issued afterwards. Tokens already issued keep their expiry and can still be refreshed until the refresh token expires; each refresh while the switch is off issues a key that never expires and no refresh token, so the app moves to non-expiring tokens on its next refresh.
- Each refresh rotates both tokens: the old refresh token and the old access token stop working.
- Reusing a rotated refresh token answers `bad_refresh_token` and does nothing else. GitHub does not revoke the chain on reuse, and neither does Ghost.

## Wire format

### Issuing tokens

Both grants on `POST /login/oauth/access_token` (device code and authorization code) answer as today when the app has the switch off:

```json
{ "access_token": "ghost_pat_…", "token_type": "bearer", "scope": "repo,read:org" }
```

With the switch on, they add the expiry and the refresh token:

```json
{
  "access_token": "ghost_pat_…",
  "expires_in": 28800,
  "refresh_token": "ghost_rt_…",
  "refresh_token_expires_in": 15897600,
  "token_type": "bearer",
  "scope": "repo,read:org"
}
```

Responses keep going through `sendOAuth`: form-encoded by default, JSON when `Accept: application/json`. Numbers are sent as numbers in JSON and as decimal strings in form encoding.

### Refreshing

```
POST /login/oauth/access_token
client_id=…&client_secret=…&grant_type=refresh_token&refresh_token=ghost_rt_…
```

On success the answer has the same shape as a grant with the switch on, with a new access token and a new refresh token, and `scope` carrying the scopes of the refresh token being used. Scopes cannot be widened or narrowed on refresh.

Errors answer `200` with `error` in the body, as GitHub does:

| Case | `error` |
| --- | --- |
| Unknown, expired, already rotated, or issued to another app | `bad_refresh_token` |
| `client_id` unknown, or `client_secret` missing or wrong | `incorrect_client_credentials` |

`client_secret` is required. Every OAuth app has one, and the built-in `gh` app has device flow only and is never issued a refresh token, so no public client reaches this grant.

Dispatch in `accessToken` gains one branch: `grant_type=refresh_token` with a `refresh_token` goes to the refresh grant. The existing device and code branches are unchanged.

## Storage

The access token stays a `ghost_pat_` API key from the api-key plugin, created with `expiresIn: 28800` when the switch is on. The existing token guard already rejects an expired key, so nothing changes on the read path.

The refresh token is Ghost's own, in a new table in its own file, `packages/db/src/schema/oauth-app-refresh-token.ts` (`oauth.ts` holds the plugins' tables only):

```
oauth_app_refresh_token
  id             text primary key
  token_hash     text not null unique      sha256 of the token, hex
  client_id      text not null → oauth_client.client_id, on delete cascade
  user_id        text not null → user.id, on delete cascade
  scopes         text[] not null
  access_key_id  text not null             no foreign key, see below
  expires_at     timestamptz not null
  created_at     timestamptz not null default now()
  index on (client_id, user_id)
```

- The token is `ghost_rt_` followed by 32 random bytes in base64url. Only its hash is stored; the plaintext is returned once.
- `access_key_id` has no foreign key on purpose. The api-key plugin deletes expired keys on its own, and a cascade would delete the refresh token with them, while the refresh token must outlive the access token by months.
- The plugin's `oauth_refresh_token` table is not used. Its rows belong to the plugin's own access tokens and sessions, which Ghost revokes right after the code exchange.
- The migration is generated with `bun db:generate` at the repository root, never written by hand.

### Rotation

In `apps/api/src/lib/github/refresh-tokens.ts` and the controller's refresh grant:

1. Check the client's credentials. A `client_secret` that is missing or not a string is refused outright; otherwise the oauth-provider plugin checks it, through `auth.api.oauth2Introspect`, so Ghost never re-implements the plugin's secret hashing. Bad credentials: `incorrect_client_credentials`.
2. In one transaction: find the row by `token_hash` and the caller's `client_id`, take the grant's advisory lock (`pg_advisory_xact_lock(hashtext(client_id), hashtext(user_id))`), then delete the row, returning it. No row, or `expires_at` in the past: `bad_refresh_token`.
3. Still in the transaction, mint the new key and, while the app's switch is on, insert the new refresh row; then delete the old key.

`revokeAuthorized` takes the same lock before it deletes the user's keys and refresh rows for the app. A refresh and a revoke of the same grant therefore run one after the other: a revoke that comes second deletes the pair the refresh just minted, and a refresh that comes second finds no row. Two concurrent refreshes with one token serialize the same way, and only one finds the row.

The key is created through the api-key plugin, which writes on its own connection, so it is not part of the transaction. If anything fails after it, the transaction rolls back: the refresh token and the old key survive, and the client can retry. The worst case is an orphaned 8-hour key nobody holds.

Expired rows are deleted when a refresh finds them, and Authorized apps ignores them. No sweeper job: a stale row costs one row until its owner refreshes, revokes, or is deleted.

## Code

| File | Change |
| --- | --- |
| `apps/api/src/github/oauth/oauth.controller.ts` | `refreshGrant` branch; `issueKey` sets `expiresIn` and adds the refresh token when the app has the switch on |
| `apps/api/src/lib/github/refresh-tokens.ts` | issue, hash, and rotate refresh tokens; the two lifetimes as constants |
| `apps/api/src/lib/github/oauth-apps.ts` | `expireUserTokens` on `OauthApp` and `oauthAppColumns`, read from `oauth_client.metadata->>'expireUserTokens'` like `deviceFlow` |
| `apps/api/src/resources/oauth-apps/` | DTO and update path take `expireUserTokens`; revoking an authorization and deleting an app also delete the matching refresh rows |
| `apps/api/src/lib/auth.ts` | api-key plugin `keyExpiration.minExpiresIn` lowered to `ACCESS_TOKEN_EXPIRES_IN / 86400` (a third of a day), so an 8-hour key is accepted. Organization deletion already deletes its `oauth_client` rows, so the `client_id` cascade removes their refresh rows with no change there |
| `apps/web/src/components/oauth-apps/` | "Expire user authorization tokens" switch in `oauth-app-fields.tsx`, next to "Enable device flow", with GitHub's help text |
| `apps/api/openapi.json`, `apps/web/src/lib/api/v1.d.ts` | regenerated with `bun run openapi` |

Lowering `minExpiresIn` also lets a user create an API key in settings that expires sooner than a day. That is harmless and is not exposed by the settings form.

## Revocation and authorized apps

The api-key plugin deletes expired keys on its own. Once an 8-hour key is gone, the app still holds a live refresh token, so Settings → Authorized apps and its revoke action read refresh rows as well as keys:

- `listAuthorized` lists an app when the user holds a key or an unexpired refresh row for it. `scopes` is the union of both; `authorizedAt` is the earliest `created_at` of either; `lastUsedAt` still comes from keys only.
- `revokeAuthorized` deletes the user's keys and refresh rows for the app under the grant's lock (see Rotation), and answers 404 only when it found neither.

Every path that revokes an app's keys for a user also deletes that user's refresh rows for the app, so a revoked app cannot refresh its way back in:

- A user revokes an app under Settings → Authorized apps.
- An app's owner deletes the app (cascade through `client_id`).
- An organization is deleted with its apps (`afterDeleteOrganization` deletes the `oauth_client` rows; the cascade does the rest).
- A user is deleted (cascade through `user_id`).

Regenerating a client secret revokes nothing, as on GitHub; the next refresh needs the new secret.

## Documentation

- New `apps/docs/content/docs/oauth-apps/refreshing-tokens.mdx`: turning the switch on, the response fields, the refresh request, errors, rotation, and what turning the switch off does. Added to the section's `meta.json`.
- `apps/docs/content/docs/github-cli/index.mdx`: note under Known differences that expiring tokens are available to OAuth apps on Ghost, where GitHub offers them only to GitHub Apps.
- `docs/0040-github-compatibility-is-a-translation-layer.md`: addendum recording the Ghost-owned refresh table, why `access_key_id` has no foreign key, and why the plugin's refresh table is not used.

## Testing

API e2e, on the throwaway Postgres and RustFS harness:

- Switch off: the device and code grants return no `refresh_token`, and the key has no expiry.
- Switch on: both grants return `expires_in`, `refresh_token` and `refresh_token_expires_in` with GitHub's values, in form-encoded and JSON responses.
- Refresh: returns a new pair with the same scopes; the new access token works on `GET /api/v3/user`.
- After a refresh, the old refresh token answers `bad_refresh_token` and the old access token answers 401.
- An expired refresh token, another app's refresh token, and an unknown token answer `bad_refresh_token`.
- A missing or wrong `client_secret` answers `incorrect_client_credentials`.
- An expired access token answers 401 (key created with its expiry in the past through the database).
- Switch turned off after issue: a refresh returns a key with no expiry and no `refresh_token`.
- Revoking the app under Authorized apps deletes its refresh tokens; a refresh afterwards answers `bad_refresh_token`.
- An app whose only access key has expired and been deleted still shows under Authorized apps, and revoking it answers 204 and deletes the refresh row; once the refresh row has expired too, the app no longer shows.
- A refresh racing a revoke leaves no key and no refresh row behind.
- A `refresh_token` or `client_secret` that is not a string answers an OAuth error, never a 500.
- The built-in `gh` app cannot have the switch turned on through the API.

Unit: refresh-token generation has the `ghost_rt_` prefix and hashing is stable.

## Out of scope

- Refresh tokens through the `offline_access` scope or OIDC ([#106](https://github.com/PhantomKnight287/ghost/issues/106))
- Expiring tokens for keys made in Ghost's settings, or for `gh`
- Configurable lifetimes
- Revoking the whole token chain when a rotated refresh token is reused
- Ghost Apps ([#109](https://github.com/PhantomKnight287/ghost/issues/109)), which will build on this table
