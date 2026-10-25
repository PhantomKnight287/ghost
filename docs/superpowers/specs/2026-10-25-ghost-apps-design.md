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
| `pull_requests` | repository | pull requests, reviews, review comments | open/edit, review, comment, merge |
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
- Rulesets treat the bot like any actor without bypass, unless a ruleset's bypass list names the app (GitHub's `Integration` bypass actor). Adding `Integration` bypass actors is in scope for slice 2 only if it is small. Otherwise it is a follow-up issue (builder's call).
- Map each endpoint and webhook event to permissions in a single table in code, so the mapping can be read and tested in one place.
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

- Install page `/apps/:slug/installations/new`. It picks the account (you or an org you admin), all or selected repositories, and shows the permissions. On install it redirects to the app's setup URL if one is set (an optional app field; add it in slice 1 if that's cheaper).
- Installed-apps settings for users and orgs: configure repositories, suspend, unsuspend, uninstall.
- GitHub endpoints, at least:
  - `GET /app/installations`, `GET /app/installations/:id`, `DELETE /app/installations/:id`;
  - `POST /app/installations/:id/access_tokens`;
  - `GET /repos/:owner/:repo/installation`, `GET /orgs/:org/installation`, `GET /users/:username/installation`;
  - `GET /installation/repositories`.
- Permission enforcement for installation tokens on every existing GitHub-compatible REST endpoint and on git over HTTPS, through the single mapping table. Unmapped endpoints are denied.
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

### Slice 4: Checks API (Ghost #79)

This is #79, not part of this design. Once slice 3 merges, comment on #79 that apps exist and that check runs should be attributed to installations the same way statuses are.

### Slice 5: User-to-server tokens (Ghost #106)

- This slice is committed; the per-app opt-in is what the issue's "optional" means. An app can turn on "Request user authorization". A user then authorizes the app through the web flow or the device flow, and the app gets an expiring token (8 hours) and a refresh token (6 months), the same as GitHub's `ghu_`/`ghr_` tokens.
- Reuse [GitHub PR #110](https://github.com/PhantomKnight287/ghost/pull/110): the `oauth_app_refresh_token` table, `issueRefreshToken`, `spendRefreshToken` and `lockGrant` in `apps/api/src/lib/github/refresh-tokens.ts`, and the `grant_type=refresh_token` branch of `POST /login/oauth/access_token`. What's left is keying grants to an app instead of only to an `oauth_client.client_id`.
- A user-to-server token acts as the user, limited to the intersection of the user's access, the app's permissions and the repositories the app is installed on. Actions show as the user, never as the bot (see anti-goals). On GitHub they also show "via app"; doing that is the builder's call.
- The app gets a client id and client secret for this flow.

### Slice 6: Permission changes, GraphQL and docs (Ghost #107)

- **Permission changes.** When the app owner raises permissions or adds events, each installation keeps its accepted set and its owner sees a "review new permissions" prompt in installed-apps settings. Accepting applies the new set and sends an `installation.new_permissions_accepted` event (name adjustable). Lowering permissions applies immediately.
- **GraphQL.** A `Bot` type for actor fields (`author`, `actor` and the rest, as on GitHub) and `App` where GitHub exposes it. Installation tokens are accepted on GraphQL, with the same permission mapping per field: unmapped fields are denied.
- **Docs.** A Ghost Apps section in `apps/docs`: registering, keys and JWT, installing, tokens, permissions, webhooks (with the Ghost format and the `installation` field), a short "porting a Probot app" note, and what's different from GitHub.

## Constraints

- Follow the repo's workflow (memory: Claude tests, user builds). For each slice, Claude writes failing tests from this document, the user writes the backend, Claude audits the result, and then Claude writes the frontend.
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

## Left to the builder

- Table layout and names, the shape of the viewer type, and how tokens are stored (hashed, like API keys).
- Whether the installation token reuses Better Auth's `apikey` table with metadata, or has its own table. Its own table is likely cleaner, because of revocation on uninstall and the intersection rules.
- Exact event names within Ghost's `noun.verb` style.
- Rate limits for installation tokens. Use the existing API key defaults unless they are clearly wrong for bots.
