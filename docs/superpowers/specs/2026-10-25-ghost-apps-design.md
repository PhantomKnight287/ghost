# Ghost Apps

Issue: #50 on Ghost (migrated from #109 on GitHub). Unblocks `integration_id` in rulesets part C (#89 on Ghost, `2026-10-23-rulesets-cd-design.md`). The Checks API is out of scope; it is #79 on Ghost and becomes its own slice after this work. #79 gets a comment once apps land.

This work ships as ordered slices, one issue and one pull request each (user decision, 2026-10-25). Each slice is useful on its own and builds on the ones before it.

## Intent

Ghost has OAuth apps ([GitHub PR #104](https://github.com/PhantomKnight287/ghost/pull/104)). An OAuth app always acts as the user who authorized it, with broad scopes such as `repo`, and its token proves nothing about which app is speaking: the device flow hands an app-tagged key to anyone who knows the app's public `client_id`.

The apps the user wants on Ghost are bots that act as themselves:

- CI that posts commit statuses;
- PR reviewers in the style of CodeRabbit and Greptile, which read diffs and post reviews and comments;
- secret scanners in the style of GitGuardian, which read pushes and pull requests and report what they find.

A Ghost App, modelled on a GitHub App, gives them three things:

- **Narrow access.** Fine-grained permissions on only the repositories it is installed on.
- **Its own identity.** Its actions show as `slug[bot]`, not as a person.
- **Proof of identity.** Only the holder of the app's private key can mint tokens that act as the app. This is what lets a ruleset pin a required check to an app.

### Compatibility target

An app built for GitHub with Octokit or Probot should run against Ghost **mostly** fine when pointed at Ghost's API base URL (user's words: "*MOSTLY* fine. 100% compat is not expected"). In practice:

- **REST: match GitHub.** Use GitHub's paths, payloads and status codes for the JWT, installation and token endpoints, and for the existing REST endpoints an installation token calls. Where this document is silent on REST behaviour, do what GitHub does.
- **Webhooks: Ghost's format, not GitHub's.** App webhooks use Ghost's existing format: `noun.verb` event names, the `X-Ghost-*` headers and the current body shape (user decision, 2026-10-25: too many things depend on the current format to change it now). Ghost adds only what an app cannot work without; see slice 3. A Probot app needs a small adapter for events. Its REST calls work unchanged.
- **Edge endpoints may be missing.** A missing endpoint answers GitHub-style 404, not something wrong.

## Goals

1. Any user or organization can register a Ghost App: name, slug, homepage, logo, permissions, subscribed events, webhook URL and secret, and private keys.
2. Apps are **public but unlisted**. Anyone with an app's install link can install it, and every app has a public page. There is no marketplace, directory or search (user decision, 2026-10-25).
3. An owner (a user, or an org admin for an org) installs an app on their account for all repositories or for selected ones, and can change the selection, suspend or uninstall it.
4. The app authenticates with a JWT signed by its private key and exchanges it for a one-hour installation token, at GitHub's paths.
5. An installation token can do only what the app's permissions allow, on only the installation's repositories, through the GitHub-compatible REST layer and git over HTTPS.
6. Everything the app does is attributed to its bot user `slug[bot]`, with a `bot` badge linking to the app page.
7. The app gets webhooks for its installations and for events on its installed repositories, through the existing delivery pipeline.
8. Commit statuses record the installation that posted them, and rulesets part C can pin a required check to an app with `integration_id`.
9. An app can opt in to acting for a user with expiring user-to-server tokens and refresh tokens, reusing [GitHub PR #110](https://github.com/PhantomKnight287/ghost/pull/110).
10. When an app asks for new permissions, an installation keeps its old ones until the owner reviews and accepts the new set.
11. GraphQL knows bots and apps, and the docs have a Ghost Apps section.

## Non-goals

- The Checks API (check runs, check suites, annotations). It is #79.
- GitHub-format webhooks (`X-GitHub-Event`, `action` fields, snake_case payloads).
- A marketplace, app directory, search, paid plans or verified publishers.
- The app manifest flow (create an app from a posted manifest).
- Enterprise or account-level permissions beyond those in the permission table below.
- Installation tokens on Ghost's own (non-GitHub) API. Ghost's web app uses that API, and apps use the GitHub-compatible layer.
- `administration` permission. It is listed for later, with no behaviour now.

## Anti-goals

These would make the work a failure even if it technically works:

- **A user can act as an app.** Anything an app's bot can do must need the app's private key, or a token minted from it. User-to-server tokens act as the user, never as the bot.
- **A token does more than both its grants allow.** An installation token must never reach a private repository outside its installation, or use a permission the app was not granted, or one the owner has not accepted. Public repositories are the one exception: as on GitHub, an installation token reads public data (outside the installation, and inside it beyond its permissions) the way an anonymous caller can, and never writes to them (Claude's call, following GitHub).
- **Unmapped means allowed.** An endpoint or GraphQL field not mapped to a permission is denied to installation tokens. Forgetting to map an endpoint must fail closed.
- **Silent permission growth.** An app that raises its permissions does not gain them on any installation until that installation's owner accepts.
- **Bots that look human.** Bot activity must show the `bot` badge everywhere a user's name appears for that activity.
- **A bot user that can sign in.** The bot user has no password, no session, no email login and no personal API keys.
- **A private key Ghost can reveal.** Ghost stores only the public half and shows the private key once, at generation.

## Permissions

Use GitHub's permission names so Octokit apps ask for the same ones (user approved, 2026-10-25).

| Permission | Scope | `read` | `write` |
|---|---|---|---|
| `metadata` | repository | always granted: repository, branches, collaborators list | — |
| `contents` | repository | files, commits, compare/diffs, git clone/fetch | git push, refs, releases |
| `pull_requests` | repository | pull requests, reviews, review comments | open/edit, review, comment; merge with `contents: write` too (Claude's call after review, 2026-10-29, as GitHub) |
| `issues` | repository | issues, comments, labels | create, edit, comment, label |
| `statuses` | repository | commit statuses | post commit statuses |
| `members` | organization | members and teams | — |
| `administration` | repository | later | later |

Rules:

- `write` includes `read`.
- An installation token's effective access to a repository is the intersection of:
  1. the repository being in the installation,
  2. the permissions the installation's owner accepted, and
  3. the permissions requested in the token call, if any (GitHub's `permissions` and `repositories`/`repository_ids` body fields narrow a token; they never widen it).
- The bot is not a collaborator. Its access comes only from the installation. A repository role (`read`, `write` and so on) does not apply to it.
- Rulesets treat the bot like any actor without bypass, unless a ruleset's bypass list names the app (GitHub's `Integration` bypass actor, with `actor_id` set to the App ID). `Integration` bypass actors are in slice 2: they follow the existing `Team` actor in the schema, `bypassOf`, the REST and GraphQL mappings and the web bypass field (user decision, 2026-10-29). If this turns out bigger than that, the builder raises a tracker issue on Ghost and moves it out.
- **Bot approvals count** (user decision, 2026-10-29). An approving review from `slug[bot]`, posted with an installation token that has `pull_requests: write` on that repository, counts toward a ruleset's required approvals as a reviewer with write access does. It satisfies code-owner review only when CODEOWNERS names the bot (Claude's call).
- **Public repositories and the decorator** (Claude's call). A route with no declaration is denied to installation tokens even on a public repository. On a declared route that the installation lacks the permission for, a read on a public repository runs as an anonymous caller would; a write is denied.
- **Bot access in Ghost's own services** (Claude's call). Services keep checking access the way they do today. The one place that resolves a caller's access to a repository learns that an installation's bot has access to its installation's repositories, as allowed by the decorator check. Services do not each special-case bots. The exact shape is the builder's.
- **Endpoint permissions are declared with a decorator, opt-in** (user decision, 2026-10-29):
  - Each GitHub-compat controller, and the git controller (`apps/api/src/git/git.controller.ts`), declares one permission with a decorator such as `@AppPermission('issues')`. The level comes from the HTTP method: `GET` and `HEAD` need `read`, every other method needs `write`.
  - A route can declare its own permissions with the same decorator. A route declaration is complete: it replaces the controller's declaration and never adds to it, and it can name several permissions with levels, such as `{ pull_requests: 'write', contents: 'read' }`. Use it wherever the method gives the wrong level, for example `POST git-upload-pack` (a fetch, so `contents: 'read'`), or where a route needs more than one permission.
  - On `info/refs`, `service=git-receive-pack` starts a push, so it needs `contents: 'write'`; any other service needs `contents: 'read'` (Claude's call, matching how `git-basic-auth` already treats the service).
  - A route with no declaration on itself or its controller is denied to installation tokens. Callers that are not installations are unaffected by the decorator.
  - One test enumerates every GitHub-compat and git route and fails if any route has no declaration, so a forgotten decorator fails CI.
  - Webhook events map to permissions in slice 3.
- **Accepted permissions are stored per installation from slice 2.** Each installation keeps a snapshot of the permissions and events its owner accepted, and enforcement reads that snapshot, never the app's current set. Until slice 6 brings the review flow, an app owner can lower permissions and remove events at any time (applied to every installation at once), but raising permissions or adding events is refused with a clear message while the app has any installation (Claude's call).

## Identity and tokens

- **App ID.** An integer, unique across Ghost, used as JWT `iss` and as `integration_id`. Every app also has a text id and a `slug` (unique, URL-safe, set from the name and changeable only if GitHub allows it; verify).
- **Bot user.** Each app gets a `user` row marked as a bot (a new column, e.g. `kind: 'user' | 'bot'`), with the username `slug[bot]`. GitHub's REST `user` objects for it carry `type: "Bot"`. The bot user cannot sign in (see anti-goals). The exact storage is the builder's call. The username must work in `/users/:username`, mentions and avatars, and must not collide with real usernames: `[` and `]` are not allowed in human usernames today, so verify that.
- **Deleting an app.** Deleting an app removes its installations and revokes every token, without sending events (there is no app left to receive them). The bot user is kept, marked deleted, so issues, comments, reviews, statuses and pushes stay attributed. No author column cascades on it. The App ID and slug are never reused, so `slug[bot]` always means one app. A ruleset whose `integration_id` names a deleted app keeps the rule, so the check can no longer be met. The ruleset page flags it so an admin can edit the rule. That fails closed rather than silently dropping a requirement (Claude's call).
- **Private keys.** "Generate private key" creates an RSA key pair. The `.pem` downloads once and only the public key is stored. An app can hold several keys so they can be rotated, and the owner can delete any key.
- **JWT.** RS256, signed with any of the app's current keys. `iss` is the App ID, `iat` may be up to 60 seconds in the future to allow for clock drift, and `exp` must be no more than 10 minutes after `iat`. These are GitHub's rules; verify the exact limits. A JWT can call only the app-level endpoints (`GET /app`, the installation list and lookups, token minting). Elsewhere it is refused, as on GitHub.
- **Installation token.** Minted by `POST /app/installations/:installation_id/access_tokens`. It expires after 1 hour, is opaque with a recognisable prefix (`ghs_`, as on GitHub, so tools that sniff prefixes work), and is accepted:
  - as `Authorization: token|Bearer <token>` on the GitHub-compatible REST layer;
  - as the password in git-over-HTTPS Basic auth (GitHub's username is `x-access-token`; Ghost ignores the username today, so this already fits).
  It is refused on Ghost's own API and, until slice 6, on GraphQL. Suspending or uninstalling revokes every token from that installation at once.
- **Where auth plugs in.** The GitHub-compat auth middleware (`apps/api/src/github/auth/github-auth.middleware.ts`) and the git Basic-auth middleware (`apps/api/src/git/middleware/git-basic-auth/`) both resolve a key to a viewer today. Both learn a third kind of caller, an installation, and `GithubViewer` grows to say which kind it is. The design of that viewer type is the builder's call.

## Slices

Each slice is one issue on Ghost, created from this document. The order matters: each one builds on the slices before it.

### Slice 1: App registration and identity (Ghost #103)

- Schema: apps, private keys (public halves), bot user. The `bun db:generate` migration is the builder's to run.
- Owner endpoints and UI to create, edit and delete an app, and to generate and delete keys. Org apps are managed by org admins.
- JWT verification, and `GET /app` at GitHub's path and shape.
- Public app page `/apps/:slug` (name, logo, homepage, owner, description) and the install link. The install page itself is slice 2.
- Docs stub.

**Done when:** an app can be registered, a key generated, and Octokit's `App` class authenticates as the app and reads `GET /app`.

### Slice 2: Installations and installation tokens (Ghost #104)

- Install page `/apps/:slug/installations/new`. It picks the account (you or an org you admin), all or selected repositories, and shows the permissions. On install it redirects to the app's setup URL if one is set (`app.setupUrl`, added in slice 1).
- Installed-apps settings for users and orgs: configure repositories, suspend, unsuspend, uninstall.
- GitHub endpoints, at least:
  - `GET /app/installations`, `GET /app/installations/:id`, `DELETE /app/installations/:id`;
  - `POST /app/installations/:id/access_tokens`;
  - `GET /repos/:owner/:repo/installation`, `GET /orgs/:org/installation`, `GET /users/:username/installation`;
  - `GET /installation/repositories`.
- Permission enforcement for installation tokens on every existing GitHub-compatible REST endpoint and on git over HTTPS, through the permission decorator (see Permissions). Undeclared routes are denied.
- Attribution: writes made with an installation token show as the bot user. That covers issues, comments, reviews, review comments, statuses, labels, releases and pushes.
- `commit_status` records the installation that posted it (a nullable column). Statuses posted with an installation token have the bot as creator and carry the installation. Statuses posted any other way leave it null.
- Rulesets part C: `integration_id` is accepted. It must name an existing app. A pinned check counts only for a status posted with an installation token of that app. Remove C's "needs Ghost Apps" refusal. Statuses from user-to-server tokens (slice 5) never satisfy a pinned check.
- `bot` badge in the web UI wherever an author or actor is shown.

**Done when:** a Probot-style app can install on a repository, mint a token, read a pull request's diff, post a review with inline comments and a status as `slug[bot]`, and is refused on a repository outside its installation or without the permission. A ruleset pinning a context to the app is satisfied only by that app's status.

### Slice 3: App webhooks (Ghost #105)

- Each app has one webhook URL and secret, set at registration. It gets the events it subscribed to, from every repository in each of its installations, filtered so it never gets an event its accepted permissions could not read. For example, `issue.*` needs `issues:read`, and `push` needs `contents:read`.
- New events in Ghost's `noun.verb` style:
  - `installation.created`, `installation.deleted`, `installation.suspended`, `installation.unsuspended`;
  - `installation.repositories_added`, `installation.repositories_removed`.
  The builder may adjust the names to match Ghost's existing style. Installation events go to the app whatever it subscribed to, as on GitHub.
- Every body sent to an app carries `installation: { id }`, the integer id the token endpoint takes. Nothing else in the body changes.
- Delivery reuses the existing `webhook_endpoint`, delivery jobs, signing (`X-Ghost-Signature-256`, `X-Hub-Signature-256`), retries and auto-disable. Whether an app's endpoint is a `webhook_endpoint` row owned by the app, or a sibling table, is the builder's call. The current `num_nonnulls(repository_id, organization_id) = 1` check will need to change either way.
- Owner UI: the app's recent deliveries and redelivery, the same as the existing repository webhook pages.
- Check that the event list covers what a reviewer bot needs: a pull request being **opened** and **closed** (not only `synchronized`, `merged` and the rest). If no event fires when a pull request is opened today, add `pull_request.opened`, `pull_request.closed` and `pull_request.reopened`. Verify against `apps/api/src/lib/webhooks/webhooks.ts`.

**Done when:** installing, changing repositories, suspending and uninstalling each deliver an event to the app. A push or a new pull request on an installed repository reaches the app with `installation.id` set, and does not reach it on a repository outside the installation.

#### Slice 3 decisions (2026-10-30)

The first consumer is the user's GitHub sync bot (`docs/superpowers/specs/2026-10-14-github-sync-bot-design.md`), rebuilt later as a Ghost App: it installs on a repository, gets `push`, `issue.*`, `pull_request.*` and `label.*` through the app's webhook, and skips its own echoes by the `slug[bot]` actor. Rewriting the sync spec is separate work, after the apps slices. Claude builds all of slice 3, backend and frontend, test-first (user decision, 2026-10-30). One pull request.

- **Pull requests get their own lifecycle events.** Today a pull request is an issue internally, so opening, editing, closing or reopening one fires `issue.opened`, `issue.edited`, `issue.closed` or `issue.reopened`. Webhooks now send `pull_request.opened`, `pull_request.edited`, `pull_request.closed` and `pull_request.reopened` for a pull request, and the `issue.*` four only for issues. `pull_request.edited` is added beyond the issue's list because the sync bot mirrors title and body edits. The split happens at the webhook layer (fan-out and the chat formats); internal events and their consumers, such as notifications and CODEOWNERS requests, stay as they are (Claude's call). Labels, assignees and comments keep their `issue.*` names for both, with the `pullRequest` key in the body, as `issue_comment` does on GitHub (Claude's call). The four new events need `pull_requests:read` in `EVENT_PERMISSIONS`.
- **The app's endpoint is a `webhook_endpoint` row** with a new `app_id` column; the owner check becomes `num_nonnulls(repository_id, organization_id, app_id) = 1` (Claude's call). `apps/delivery`, signing, retries, the breaker and auto-disable then work unchanged. The app's webhook URL and secret move off the `app` table onto that row: the apps service creates, updates or deletes the row when the URL is set, changed or cleared, and soft-deleting the app deletes it.
- **Fan-out to apps.** For a repository event, an app endpoint gets the event when: the endpoint is active; the app is not deleted; an installation of the app on the repository's owner account is not suspended and covers the repository (`all`, or the repository is in `app_installation_repository`); the event is in that installation's accepted `events`; and the installation's accepted `permissions` include the event's `EVENT_PERMISSIONS` entry. The body is the same as for a repository webhook plus `installation: { id }`, the installation's `numericId`. Repository and organization webhooks are unchanged.
- **Installation events** have no repository, so they do not go through the repository outbox. The installations service enqueues them directly for the app's endpoint, in the same transaction as the change, whatever the app subscribed to. Body: `event`, `installation` (`id`, `account`, `repositorySelection`, accepted `permissions` and `events`), `sender`, `createdAt`, and for `installation.repositories_added` and `installation.repositories_removed` the `repositories` that changed. `installation.created` lists the selected repositories, or none for `all`. Switching between `all` and `selected` sends the added or removed repositories the switch implies, as on GitHub (Claude's call). A suspended installation gets `installation.unsuspended` and nothing else until unsuspended (Claude's call). `installation.deleted` is the last event sent.
- **Owner UI.** The app's settings get a Webhook section (active toggle, recent deliveries, redelivery, the auto-disable notice) built from the existing repository webhook pages and endpoints, keyed by the app's endpoint.
- **Existing subscriptions break, on purpose.** No migration adds the new `pull_request.*` events to existing repository or organization endpoints. An endpoint subscribed to `issue.opened` stops getting pull request opens until its owner ticks `pull_request.opened` (user decision, 2026-10-30).
- **One list of webhook events, in a new package `packages/webhooks` (`@ghost/webhooks`)** (user decision, 2026-10-30). Today the list lives in four places: `webhookEvents` in `apps/api/src/lib/webhooks/webhooks.ts`, `EVENT_PERMISSIONS` in `packages/permissions/src/apps.ts`, `webhookEventLabels` in `apps/web/src/lib/webhooks.ts`, and the `WebhookEvent` enum in the generated OpenAPI types. The package holds one table, keyed by event name, giving each event's picker label and the app permission it needs, plus the installation events, marked as not subscribable. It exports the subscribable event tuple, the `WebhookEvent` type, labels and permissions. The API, the web picker, `@ghost/permissions` and the app event filter all read from it; the OpenAPI enum is generated from the API's tuple, so it follows. The internal `EventPayloads` in `apps/api/src/lib/events/events.ts` stay where they are: they are internal events, not webhook events, and the API keeps its `satisfies` check that ties the two. Its package shape (exports, build, `bun test`) copies `@ghost/permissions`.
- **Out of scope:** a per-installation webhook (one URL per app, as on GitHub); GitHub-format bodies; backfill of events missed before install.

### Slice 4: Checks API (Ghost #79)

This is #79, not part of this design. Once slice 3 merges, comment on #79 that apps exist and that check runs should be attributed to installations the same way statuses are.

### Slice 5: User-to-server tokens (Ghost #106)

- This slice is committed; the per-app opt-in is what the issue's "optional" means. An app can turn on "Request user authorization". A user then authorizes the app through the web flow or the device flow, and the app gets an expiring token (8 hours) and a refresh token (6 months), the same as GitHub's `ghu_`/`ghr_` tokens.
- Reuse [GitHub PR #110](https://github.com/PhantomKnight287/ghost/pull/110): the `oauth_app_refresh_token` table, `issueRefreshToken`, `spendRefreshToken` and `lockGrant` in `apps/api/src/lib/github/refresh-tokens.ts`, and the `grant_type=refresh_token` branch of `POST /login/oauth/access_token`. What's left is keying grants to an app instead of only to an `oauth_client.client_id`.
- A user-to-server token acts as the user, limited to the intersection of the user's access, the app's permissions and the repositories the app is installed on. Actions show as the user, never as the bot (see anti-goals). On GitHub they also show "via app"; doing that is the builder's call.
- The app gets a client id and client secret for this flow.

#### Slice 5 decisions (2026-10-30)

The user's rule for this slice: copy GitHub (user decision, 2026-10-30). The main use is an app's own website signing a Ghost user in and showing what they can reach (`GET /user`, `GET /user/installations`), as Vercel, CodeRabbit and Linear do on GitHub; acting as the user is the rarer case. Claude builds all of slice 5, backend and frontend, test-first (user decision, 2026-10-30). One pull request.

- **Every app can sign users in; no switch turns it on.** This replaces the bullets above that call user authorization an opt-in. Each app gets a client id and client secrets (several, as GitHub allows, each shown once) and callback URLs (up to 10). GitHub's "Request user authorization (OAuth) during installation" is a separate checkbox: when on, installing sends the installer through the web flow, and the callback gets `code`, `installation_id` and `setup_action=install`, instead of the setup URL redirect.
- **Settings shared with Ghost's OAuth apps.** "Expire user authorization tokens" (on by default) and "Enable Device Flow" (off by default) behave as they do for OAuth apps. The builder may back the app's client with an `oauth_client` row tied to the app, so `/login/oauth/authorize`, `/login/device/code` and `/login/oauth/access_token` serve both kinds; that is the builder's call.
- **Tokens.** The access token is `ghu_` + random and lasts 8 hours; the refresh token is `ghr_` + random and lasts 6 months, reusing `issueRefreshToken`, `spendRefreshToken` and `lockGrant` keyed to the app's client. With expiry off the token never expires and no refresh token is issued. A user-to-server token has no scopes: `scope` is empty in the reply and any requested scope is ignored.
- **Access.** A user-to-server token may use a permission only if the app holds it and the user's own role allows it, on a repository only if the user can see it and an installation of the app covers it (`installationCovers`, not suspended). Without any installation it still reads `/user` and the user's own public data. Uninstalling or suspending does not revoke the token; it loses repository access through the rule above. Refusals use the slice 2 message and status codes.
- **Endpoints.** `GET /user/installations` (the installations of the token's app that the user can access: on their own account, or on an organization they belong to) and `GET /user/installations/{installation_id}/repositories` (the installation's repositories the user can see), with GitHub's response shapes and `total_count`. Only user-to-server tokens may call them, as on GitHub.
- **Attribution.** Everything done with the token is the user's, never the bot's. Comments, reviews, issues and statuses record the app they came through, and the web UI shows "via app-name" next to the user, linking to the app page (GitHub's "via" label). A status posted with a user-to-server token never satisfies a ruleset check pinned with `integration_id`.
- **Revoking.** The user revokes an app from Authorized apps, which deletes its tokens and refresh tokens for them. The app can revoke with GitHub's `DELETE /applications/{client_id}/token` (one token) and `DELETE /applications/{client_id}/grant` (every token of that user), authenticated with HTTP Basic client id and secret.
- **Checking.** `POST /applications/{client_id}/token` with `{ access_token }`, under the same Basic auth, answers GitHub's authorization shape (the token's user, app, expiry and `token_last_eight`) for a live token of that app, and 404 otherwise (user decision, 2026-10-30).
- **Claude's calls, settled while writing this:**
  - User-to-server tokens work where installation tokens do: the GitHub-compatible REST layer and git over HTTPS. Not Ghost's own API. GraphQL waits for slice 6, as for installation tokens.
  - Rate limits count against the user's authenticated budget.
  - An app keeps at most 20 client secrets, like its private keys. Only each secret's hash, or its sealed form if the OAuth plugin needs it, is stored, and the last characters are shown to tell them apart.
  - Apps registered before this slice get their client the first time it is needed, or through the migration; either is fine.
  - "Request user authorization during installation" can only be ticked once the app has a callback URL.
  - `GET /user/installations` lists an installation when it is on the user's own account, or when the user can see at least one repository it covers, which is GitHub's rule.
- **Moved to slice 6:** token reset (`PATCH /applications/{client_id}/token`) and scoped tokens (`POST /applications/{client_id}/token/scoped`) (user decision, 2026-10-30). Until then they answer GitHub-style 404.

### Slice 6: Permission changes, GraphQL and docs (Ghost #107)

- **Permission changes.** When the app owner raises permissions or adds events, each installation keeps its accepted set and its owner sees a "review new permissions" prompt in installed-apps settings. Accepting applies the new set and sends an `installation.new_permissions_accepted` event (name adjustable). Lowering permissions applies immediately.
- **GraphQL.** A `Bot` type for actor fields (`author`, `actor` and the rest, as on GitHub) and `App` where GitHub exposes it. Installation tokens are accepted on GraphQL, with the same permission mapping per field: unmapped fields are denied.
- **Token reset and scoped tokens.** `PATCH /applications/{client_id}/token` swaps a user-to-server token for a new one and revokes the old. `POST /applications/{client_id}/token/scoped` returns a narrower token, limited to the repositories and permissions asked for, never more than the original. Both use the slice 5 Basic auth and answer GitHub's shapes (moved here from slice 5, user decision, 2026-10-30).
- **Docs.** A Ghost Apps section in `apps/docs`: registering, keys and JWT, installing, tokens, permissions, webhooks (with the Ghost format and the `installation` field), a short "porting a Probot app" note, and what's different from GitHub.

#### Slice 6 decisions (2026-10-31)

Claude built all of slice 6 (user decision, 2026-10-31). One pull request. Claude's calls:

- **Pending permissions are computed, not stored.** An installation has something to review when the app asks for a permission level or event its accepted set lacks. `PUT /api/installations/{id}/permissions` copies the app's current set onto the installation; with nothing pending it changes nothing and sends no event. The event is `installation.new_permissions_accepted`.
- **A change that lowers and raises at once** lowers each installation to what both sets allow straight away, and leaves the raised part pending.
- **GraphQL maps permissions per object type, and per root field.** Every object type needs a permission to read its fields, so a node reached through `node`, `search` or a payload is held to its own type; Query and Mutation fields each list their permission and level. Unmapped types and root fields are denied, and a test fails when one is added unmapped. `createRepository` is denied on purpose. Root fields are checked by AppPermissionGuard, the rest by a field middleware, since Nest runs guards only on root fields.
- **User-to-server tokens stay refused on GraphQL.** Repository access only knows to narrow to an installation's repositories for installation tokens; `ghu_` tokens on GraphQL would reach every repository the user can see.
- **`App` is exposed through `RepositoryRulesetBypassActor.actor`**, GitHub's `BypassActor` union. A team bypass actor resolves to null there for now.
- **Scoped tokens** store the installation, permissions and repositories they are narrowed to on `app_user_token` (each null when not narrowed). `target` names a user or organization login, `target_id` its numeric id. `/user/installations` is not narrowed for a scoped token. A reset keeps the old token's scope and expiry setting.

## Constraints

- Follow the repo's workflow (memory: Claude tests, user builds). For each slice, Claude writes failing tests from this document, the user writes the backend, Claude audits the result, and then Claude writes the frontend.
- Slice 2 is the exception: Claude implements all of it, backend and frontend, still test-first (user decision, 2026-10-29).
- Slice 2 ships as one pull request (user decision, 2026-10-29).
- Generate SQL migrations with `bun db:generate`. Never hand-edit them.
- Every slice adds its endpoints to the GitHub-compat conformance tests where those exist.
- Use the dual-PR workflow. Ghost PRs merge with `--merge`.

## Decisions taken by the user

- Ghost Apps serve CI, PR reviewers and secret scanners first (2026-10-25).
- GitHub apps should run "mostly fine". 100% compatibility is not expected (2026-10-25).
- Webhooks stay in Ghost's format (2026-10-25).
- Apps are public but there is no marketplace (2026-10-25).
- The Checks API is #79, a separate slice (2026-10-25).
- The permission table above (2026-10-25).
- The registration, install, installed-apps and bot-badge pages, as wireframed (2026-10-25):
  - `/settings/apps` and `/settings/apps/new`, next to OAuth apps, and the same under an org's settings. The form covers owner, name (which shows the `slug[bot]` preview), homepage, logo, webhook URL and secret, subscribed events (filtered by the permissions picked), and the permission table. The app detail page shows the App ID, slug, install link and private keys.
  - `/apps/:slug` (public page) and `/apps/:slug/installations/new` (account picker, all or selected repositories, permission summary, Install).
  - `/settings/installations` and `/:org/settings/installations`: one row per installation, with Configure (repositories and permissions), Suspend and Uninstall.
  - A `bot` badge next to the app's name on comments, reviews, statuses and issues, linking to the app page.
- Split into issues, one per slice (2026-10-25).
- Slice 3 serves the GitHub sync bot first; Claude builds all of it (2026-10-30).
- Slice 3's pull request event split breaks existing subscriptions with no migration, and webhook events move to `@ghost/webhooks` (2026-10-30).
- Slice 5 copies GitHub: every app can sign users in, the main use is an app's own website; Claude builds all of it (2026-10-30).

## Left to the builder

- Table layout and names, the shape of the viewer type, and how tokens are stored (hashed, like API keys).
- Whether the installation token reuses Better Auth's `apikey` table with metadata, or has its own table. Its own table is likely cleaner, because of revocation on uninstall and the intersection rules.
- Exact event names within Ghost's `noun.verb` style.
- Rate limits for installation tokens. Use the existing API key defaults unless they are clearly wrong for bots.
