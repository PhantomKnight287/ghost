# Ghost Sync

A hosted service at `sync.<ghost domain>` that keeps a Ghost repository and a GitHub repository in sync, both ways: code, pull requests, reviews, issues, comments and labels. Two uses: tools that only exist on GitHub (CodeRabbit and other review bots, GitHub Actions) work on Ghost repositories, with their output and conversation coming back to Ghost; and a team moves from GitHub to Ghost gradually, working on either side while it does.

This replaces `2026-10-14-github-sync-bot-design.md` (on branch `feat/github-sync`, worktree `../ghost-sync`). That design was a self-hosted container configured by environment, with a dedicated bot account and personal token on each side. Its loop prevention, attribution and review rules carry over. Its "Ghost is the source of truth, GitHub is overwritten" model does not: neither side is the source (user decision, 2026-11-09, see Code). Nor do how users set it up, how it authenticates and how it is built. Work happens in this repository on a branch off `main`, not in that worktree (user decision, 2026-11-09).

## Intent

Any Ghost user signs in to Ghost Sync with Ghost, connects GitHub, picks a Ghost repository and a GitHub repository (an existing one, or a new one Ghost Sync creates), and sync starts. People keep working on whichever side they like; work done on one side appears on the other. A bot installed on the GitHub mirror reviews pull requests there; its reviews and comments appear on the Ghost pull request, and replies written on Ghost reach the bot on GitHub, so `@coderabbitai explain this` works entirely from Ghost. GitHub's check runs and commit statuses (deploys from Railway, Vercel and the like) appear on the Ghost commit, so Ghost's tick matches GitHub's.

Ghost Sync is an **outside customer of Ghost** (user decision, 2026-11-09). It has its own services, its own database and its own deploy, and talks to Ghost only through Ghost's public API as a Ghost App, exactly as CodeRabbit would. It shares no tables, no code paths and no secrets with `apps/api`. It dogfoods Ghost Apps (`2026-10-25-ghost-apps-design.md`) and the Checks API (`2026-11-06-checks-api-design.md`).

## Goals

1. Sign in with Ghost. A Ghost account is a Ghost Sync account.
2. Connect a GitHub account to it.
3. Create a sync: one Ghost repository paired with one GitHub repository, existing or newly created (private or public, the user chooses).
4. Sync runs continuously from webhooks on both sides, with a periodic reconcile pass for missed events and the initial backfill.
5. A dashboard lists the user's syncs with their health. A sync's page shows recent activity and lets the user resync, pause, resume and delete it.
6. Everything the service writes shows as its app's bot on each side (`<slug>[bot]`), never as a person.
7. All of the sync behaviour below, including checks, in the first version (user decision, 2026-11-09).

## Non-goals

- Self-hosting. The env-configured container from the old design is gone.
- Billing, quotas, invite lists or any gating. Free, no limits for now (user decision, 2026-11-09). Do not build hooks for adding them later.
- Assignees, reactions, milestones (unchanged from the old design).
- A "source of truth" setting per sync. Neither side wins (user decision, 2026-11-09).
- Syncing one Ghost repository to several GitHub repositories, or the reverse.
- Any change to Ghost itself (`apps/api`, `apps/web`, `packages/*`). If Ghost turns out to lack something, raise a Ghost issue; do not reach into Ghost's database or internals.

## Anti-goals

These would make the work a failure even if it technically works:

- **Reviews gain power across sides.** A review from one side never approves or blocks a pull request on the other; it lands as a comment-only review. A copied GitHub check is just a check run; whether a ruleset requires it is the Ghost repository owner's choice.
- **Code leaks.** A private Ghost repository reaches a GitHub repository only because its owner picked that repository. Ghost Sync never makes a repository public on its own; a new repository is created with the visibility the user chose, private selected by default.
- **Ghost Sync destroys anything on its own judgement** (user decision, 2026-11-09). It never force-pushes, deletes a branch or tag, or discards commits because it decided to. It only copies a destructive change a person made on one side (a force-push, a branch deletion, a comment or issue deletion), and only when the other side has nothing that copy would lose. When it cannot tell, it leaves both sides alone and flags it.
- **Acting on repositories the user cannot reach.** A user can only create a sync when they are an **admin of both repositories** (user decision, 2026-11-09) and both app installations cover them. Ghost Sync checks this with the user's own tokens when the sync is created, and again on every reconcile; a sync whose creator lost admin on either side, or deleted their account, stops (user decision, 2026-11-09).
- **Tokens leak.** Tokens never appear in argv, a git remote URL, a log line, an activity entry or an API response to the browser. Stored OAuth tokens are encrypted at rest.
- **Echo loops.** An event caused by Ghost Sync's own bot is never mirrored back.

## Constraints

- Lives in this monorepo under nested workspaces (user decision, 2026-11-09). Add `"apps/sync/*"` to the root `package.json` `workspaces`. `apps/sync` itself has no `package.json`.
  - `apps/sync/api` — `@ghost/sync-api`: Bun, Hono, better-auth (user decision).
  - `apps/sync/web` — `@ghost/sync-web`: TanStack Start (user decision).
  - `apps/sync/db` — `@ghost/sync-db`: drizzle schema and migrations for Ghost Sync's own Postgres, separate from `packages/db` (Claude's call; the user did not object). Migrations are generated, never hand-written, as in `packages/db`.
- Follow `docs/code-standards.md`.
- Its own Postgres. Deployed on Railway, like the rest of Ghost (`docs/deploy-railway.md`), at `sync.<ghost domain>` for the web and an API domain of the builder's choosing. One API instance (see Ordering).
- Ghost's GitHub-compatible REST is at `<GHOST_API_URL>/api/v3`. GitHub and Ghost both speak GitHub REST, so one REST client serves both sides (unchanged from the old design).

## Identity and auth

### Two apps

| | Ghost App `ghost-sync` | GitHub App (same name where available) |
| --- | --- | --- |
| Registered by | The operator, once, on Ghost's settings (`/settings/apps/new`) | The operator, once, on GitHub |
| Writes as | `ghost-sync[bot]` | `<slug>[bot]` |
| Repository permissions | `contents: write`, `pull_requests: write`, `issues: write`, `checks: write`, `statuses: write`, `metadata: read` | `contents: write`, `pull_requests: write`, `issues: write`, `checks: write`, `statuses: write`, `metadata: read`, `administration: write` (to create repositories with the user's token) |
| Events | `push`, `pull_request.*`, `issue.*` (including `issue.deleted`), `label.*`, `check_suite.requested`, `check_suite.rerequested`, `check_run.created`, `check_run.completed`, `check_run.rerequested`, `commit_status.created`, `installation.*` | Push, Create, Delete, Pull request, Issues, Issue comment, Label, Pull request review, Pull request review comment, Pull request review thread, Check run, Status, Installation, Installation repositories |
| User sign-in | Yes: this is how users log in | Yes: to link GitHub, list repositories and create a repository |
| "Request user authorization during installation" | On | On |

Both apps are registered by hand by the operator. `apps/sync/README.md` lists the exact settings above. Ghost Apps keep GitHub's names (`installation_id`, `setup_action`, the `ghu_`/`ghr_`/`ghs_` token kinds, JWT rules), so the same code mints tokens on both sides.

### Sign-in and linking

- better-auth in `apps/sync/api`. Ghost is the sign-in provider through better-auth's generic OAuth plugin, pointed at Ghost's `/login/oauth/authorize` and `/login/oauth/access_token`, with `GET /api/v3/user` for the profile. GitHub is linked to the same user as a second account (better-auth account linking), never used to sign in on its own.
- better-auth's `encryptOAuthTokens` (or equivalent) is on. Both sides issue expiring user tokens with refresh tokens; refresh them when they expire.
- User tokens are used only for what the user is choosing: listing installations (`GET /user/installations`) and their repositories, checking the user can see a repository, and creating a GitHub repository. Everything the sync itself does uses installation tokens.

### Installation tokens

- The API holds both apps' private keys (env), signs a JWT and mints a one-hour installation token per installation, caching it until shortly before expiry.
- git over HTTPS uses the installation token as the Basic password with username `x-access-token`, passed through `GIT_CONFIG_*` environment variables setting `http.<origin>.extraHeader`, as `apps/importer` does. Never in argv or a remote URL.

## Setup flow (screens)

Agreed in the visual companion on 2026-11-09. Option A for "new sync". The overwrite warning shown there is replaced by the summary below, since nothing is overwritten any more.

1. **Landing** (signed out). One line on what it does, "Sign in with Ghost".
2. **Dashboard.** Header shows the GitHub connection ("Connect GitHub" until linked). A table of the user's syncs: Ghost repository, GitHub repository, status, last synced. "+ New sync".
3. **New sync**, one page:
   - **Ghost repository:** a picker of repositories covered by the user's `ghost-sync` installations on which the user is an admin. Below it, "Missing one? Install ghost-sync on Ghost", linking to the app's install page.
   - **GitHub repository**, two choices:
     - **Existing:** a picker of repositories covered by the user's GitHub App installations on which the user is an admin, with an install link like the Ghost one.
     - **Create new:** owner (the user, or a GitHub organization the user can create repositories in), name, and Private / Public, Private selected by default. The repository is created empty with the user's GitHub token. If the GitHub installation on that owner covers selected repositories only, the new repository is added to it (verify with GitHub's docs which token can do this; if none can, send the user to the installation's settings and wait for `installation_repositories.added`).
   - **What will happen:** when the existing GitHub repository is not empty, a summary lists what the first sync does (see First sync): branches that will be copied each way, branches that differ on both sides and will be left alone and flagged, and the open issues and pull requests that will be copied each way (counts). Nothing is overwritten, so no typed confirmation (Claude's call; the old overwrite warning existed only because the old design overwrote).
   - A Ghost repository already in a sync cannot be picked again (one sync per Ghost repository, and one per GitHub repository).
   - "Start sync" creates the sync and starts the first reconcile (backfill).
4. **Sync page.** Health ("Healthy", "Syncing", "Backfilling", "Paused", "Disconnected", or the last error), diverged or rejected refs with both commits, last reconcile time, backfill counts, a recent activity list (what synced which way, what was skipped and why), and Resync now, Pause/Resume, Delete.

Who can do what: a signed-in user who is an admin of both repositories, both covered by the installations, can create a sync (user decision, 2026-11-09). Only the user who created it can pause, resume, resync or delete it (Claude's call). Sharing a sync's page with others is not in this version.

### Lifecycle (Claude's calls; the user saw them and did not object)

- **Delete:** stops syncing and removes the sync's links, bases, activity and bare repository. Both repositories are left untouched; neither is ever deleted. `ghost-pr/*` branches already on GitHub are left too.
- **Pause:** incoming webhooks for the sync are acknowledged and dropped. Resume runs a reconcile to catch up. Deletions made while paused are not caught (as with downtime).
- **Owner lost access** (user decision, 2026-11-09): every reconcile checks, with the creator's user tokens (refreshed as needed), that the creator still exists and is an admin of both repositories. If not, the sync stops with status `disconnected` and the reason "owner lost access". Webhooks for it are dropped. It resumes only if the creator regains admin on both and presses Resume (or another admin of both deletes it and creates a new one).
- **Disconnected:** an app uninstalled or suspended, or a repository removed from an installation, on either side (from `installation.*` / `installation_repositories` events, or a 401/404 on use). Sync stops; the page says which side and links to fix it. Nothing is deleted. When the installation covers the repository again, the sync resumes with a reconcile.

## What syncs, and which way

### Code (user decision, 2026-11-09)

Branches and tags sync both ways. Ghost Sync keeps, per sync and ref, the **base**: the commit both sides last agreed on. For each ref it compares Ghost's commit, GitHub's commit and the base:

| Ghost | GitHub | Action |
| --- | --- | --- |
| Equal to base | Equal to base | Nothing. |
| Changed (moved, force-pushed or deleted) | Equal to base | Copy Ghost's change to GitHub exactly: fast-forward, force-push or delete. A person made it; the other side loses nothing. |
| Equal to base | Changed | The same, GitHub to Ghost. |
| Changed | Changed, to the same commit | Record the new base. |
| Changed | Changed, one contains the other | Fast-forward the one behind. |
| Changed | Changed, neither contains the other, or one deleted and the other moved | **Diverged.** Touch neither side. Flag it (below). |
| Exists | Missing, no base (new ref) | Create it on the other side. Same the other way. |

- Every push names the commit it expects to replace (`--force-with-lease=<ref>:<expected>`, or the equivalent for a create or delete), so a person pushing at the same moment makes Ghost Sync's push fail rather than be overwritten. A failed lease re-runs the comparison.
- Tags follow the same table; a tag moved or deleted by a person is copied only when the other side still has the base.
- **Diverged** shows on the sync page with both commits, fails the "Sync" check on the Ghost commit (see Checks), and posts one comment on a synced pull request whose head it is. It clears on its own when a person makes the two sides agree (for example by merging one into the other and pushing), at which point the table applies again.
- A push rejected by branch protection or a ruleset on either side is flagged the same way, naming the rule. Ghost Sync never asks for a bypass; the README explains that the owner may add the app to bypass lists if they want protected branches synced.

### Pull requests (user decision, 2026-11-09)

Pull requests sync both ways, whichever side they are opened on. The bot opens the counterpart with the same head, base, title, body (attributed) and draft state, after the head and base refs are synced. Edits, closing, reopening, ready for review and converting to draft follow both ways.

- **Merged on one side:** the base branch's new commits reach the other side through Code. The counterpart is then marked merged if that host sees it as merged (a plain merge), otherwise the bot closes it with a "Merged on Ghost" / "Merged on GitHub" comment. If the base has diverged, the counterpart stays open and the divergence is flagged.
- **Pull requests from forks on Ghost:** the head is fetched from the base repository's `refs/pull/<number>/head` and pushed to `ghost-pr/<number>` on GitHub, which heads the GitHub pull request. This branch belongs to Ghost Sync: it follows the fork's head exactly (including force-pushes) and is deleted when the pull request closes (Claude's call; the user confirmed fork pull requests are mirrored).
- **Pull requests from forks on GitHub:** not synced (user decision, 2026-11-09, for the first sync; Claude's call to keep it for later ones, since on a public mirror it would push any stranger's code into the Ghost repository). They are listed as skipped in activity.

### Reviews

Both ways, never with power: a review from one side lands on the other as a comment-only review whose body states the original verdict ("Approved on GitHub by @x"). Line comments and replies sync both ways with the same path, line, side and range, in the matching thread. A bot on either side can never approve or block a merge on the other. (Unchanged rule, now in both directions.)

### Checks

- Check runs sync both ways (user decision, 2026-11-09): a run on a synced commit on one side is copied to the same commit on the other, same name, status, conclusion, title and summary, `details_url` pointing at the original run, updated in place as the original changes. A copied run appears under Ghost Sync's app on the other side, not the original app. Runs created by Ghost Sync itself (copies and the "Sync with GitHub" run) are never copied back.
- Commit statuses sync both ways (user decision, 2026-11-23). Deploy services such as Railway and Vercel report through the Status API, not as check runs. For each context, the newest status on a synced commit is posted onto the same commit on the other side, with the same state, description and `target_url`, so "Details" opens the original deploy. Statuses are append-only, so no link is stored: the other side's newest status for that context shows whether it is already copied. Statuses Ghost Sync posted are never copied back. A context that someone else reports on the other side stays theirs and is not overwritten. GitHub Deployments have no Ghost equivalent; their statuses reach Ghost only when the deploy service also posts a commit status, as Railway and Vercel do.
- **The "Sync with GitHub" check** (from the Checks design, 2026-11-06): on `check_suite.requested` for a commit on a synced Ghost repository, the app creates a run on that commit, `in_progress`, and completes it `success` once the commit is on GitHub, or `failure` with the reason (diverged, push rejected, installation missing). `check_run.rerequested` or `check_suite.rerequested` on that run, or on any copied run, means "sync again": reconcile the sync, then complete a fresh run. Re-running GitHub's own CI is not something Ghost Sync does.

### Issues, comments and labels

- **Issues.** Opened, edited, closed, reopened and deleted, from either side. Deletion uses the GraphQL `deleteIssue` mutation on both sides (neither REST API deletes issues), with the installation token. Ghost: Ghost #135 / #136 added the mutation, needing `issues: write`, and the `issue.deleted` event. GitHub: the `issues` `deleted` event; whether an installation token with `issues: write` may call `deleteIssue` or it needs more is to be verified, and if GitHub refuses, the counterpart is closed with a "Deleted on GitHub"-style comment and an activity entry. Pull requests are never deleted (neither host allows it).
- **Comments** on synced issues and pull requests: created, edited and deleted, from either side (user decision, 2026-11-09: deletions people make are copied).
- **Labels.** Added to and removed from issues and pull requests. A label used on one side is created on the other if missing, same name, color and description. Label edits and deletions sync by name.
- Conflicting edits to the same field: last write wins, per field.
- **Anyone's activity.** On a public repository any user can open issues and comment; all of it syncs to the other side as the bot with attribution (user decision, 2026-11-09). No filter on author.

### First sync (user decision, 2026-11-09)

A new sync has no base for any ref. The first reconcile:

1. **Refs:** a ref on one side only is created on the other. A ref on both sides at the same commit records the base. A ref on both sides at different commits fast-forwards if one contains the other, otherwise it is diverged and flagged. Nothing is overwritten or deleted.
2. **Open pull requests on both sides** (except fork pull requests on GitHub), with their reviews, review comments, comments and labels, are copied to the other side and linked. A pull request whose head or base ref is diverged is still created if both refs exist on the other side; otherwise it is skipped with an activity entry and picked up once the refs agree.
3. **Open issues on both sides**, with comments and labels, are copied and linked.
4. Closed issues and pull requests are copied too, by the same rules as open ones (user decision, 2026-11-09). A closed or merged pull request is created on the other side and then closed (with a "Merged on X" comment if it was merged) when the host accepts it. When the host refuses (head branch gone, or no commits between base and head, as for most merged pull requests), it is skipped with an activity entry (user decision, 2026-11-09). No placeholder issue is made.

The sync shows "Backfilling" until this finishes.

## Loop prevention

Any event whose actor is the app's bot on that side (`ghost-sync[bot]`, `<slug>[bot]`) is skipped. For code, the base makes this doubly safe: after Ghost Sync copies a change, both sides equal the new base and the echo finds nothing to do.

Every body the bot writes carries a hidden marker and an attribution line:

```
<!-- ghost-sync:from=github author=coderabbitai -->
**@coderabbitai** on GitHub:

<original body>
```

The marker is stripped when a body is read and added when it is written, so editing a mirrored item on either side never stacks attribution lines. A body that already carries the marker is never mirrored back. Mirrored check runs are recognised by their link, not a marker.

## Components

```
apps/sync/
  db/                 @ghost/sync-db: drizzle schema, generated migrations
  api/src/
    index.ts          Hono app: better-auth routes, the web's JSON API,
                      POST /webhooks/ghost, POST /webhooks/github, GET /health.
                      Starts the reconcile timer.
    config.ts         Environment parsed with zod.
    auth.ts           better-auth: Ghost generic OAuth, GitHub linking.
    apps.ts           JWT signing and installation-token cache, one per side.
    verify.ts         Webhook signature checks for both sides.
    rest.ts           GitHub-style REST client, one instance per side.
    git.ts            One bare repository per sync: fetch both sides, push either way with a lease.
    queue.ts          One serial queue per sync.
    handlers/ghost.ts   Ghost event to sync calls.
    handlers/github.ts  GitHub event to sync calls.
    sync/refs.ts      The three-way table above.
    sync/pulls.ts issues.ts comments.ts reviews.ts labels.ts checks.ts
    reconcile.ts      Lists both sides and calls the same sync functions.
    format.ts         Marker, attribution line, verdict text.
    routes/           The web's API: me, installations and repositories, syncs CRUD,
                      activity, resync/pause/resume.
  web/                @ghost/sync-web: TanStack Start, the four screens above.
```

Each `sync/*` function brings one item into agreement across the two sides and is idempotent: it looks up the item's link, creates the item if there is none, and updates it otherwise. Webhook handlers and the reconcile pass both call these functions. They take the sync and its two REST clients as arguments and never read global config, so one process serves every sync.

The web talks only to `apps/sync/api`. The split of the web's API into routes is the builder's.

## Data

Tables in `@ghost/sync-db` (shape is the builder's; this is what must be stored):

- better-auth's own tables (user, session, account with encrypted tokens).
- `sync`: owner user, Ghost repository (owner/name and id), GitHub repository (owner/name and id), the two installation ids, status (`backfilling`, `active`, `paused`, `disconnected`, `error`), last error, `last_reconciled_at`, created and updated times. Unique on the Ghost repository id and on the GitHub repository id.
- `ref`: `(sync, name, base_sha)`, the base for each branch and tag, plus a diverged flag with both sides' commits for the sync page. Written only after a push succeeds or both sides are seen to agree.
- `link`: `(sync, kind, ghost_id, ghost_rest_id, github_id, updated_at)`, kind one of `issue`, `pull`, `comment`, `review`, `review_comment`, `label`, `check_run`. Unique on `(sync, kind, ghost_id)` and on `(sync, kind, github_id)`. Identity only.
  - Issues and pull requests keyed by number on both sides.
  - Comments, reviews and review comments keyed on Ghost by UUID (what Ghost webhooks carry); Ghost's REST `node_id` is the type prefix and the base64url UUID, so a REST answer maps to the same key. `ghost_rest_id` keeps the numeric REST id needed to edit or delete.
  - Labels keyed on Ghost by UUID and on GitHub by name.
  - Check runs keyed by their ids on both sides.
- `delivery`: `(side, delivery_id, received_at)`. Seen before means acknowledge and drop. Pruned after 7 days.
- `activity`: `(sync, at, direction, kind, summary, error)`, feeding the sync page. Pruned after 30 days (Claude's call). Summaries name items and people, never tokens or bodies.

Repository ids, not names, identify a sync's repositories, so a rename on either side does not break it. Names are refreshed for display.

## Data flow

### Webhooks

Both apps have one webhook URL each for every installation.

1. Verify the signature. Ghost: `X-Ghost-Signature-256` over `<timestamp>.<body>`, rejecting a timestamp more than five minutes off (`docs/webhooks.md`). GitHub: `X-Hub-Signature-256` over the body. Failures answer 401.
2. Delivery id (`X-Ghost-Delivery`, `X-GitHub-Delivery`) already in `delivery`: answer 200, stop.
3. `installation.*` events update the affected syncs' status (and, when a repository is added, the installation id on its sync), then stop. Ghost Sync keeps no table of installations: pickers ask the hosts live with the user's token, and each sync holds the installation ids it uses (decision, 2026-11-16).
4. Find the sync by repository id. None, or paused: record the delivery, answer 200, stop.
5. Actor is the bot for that side: record, answer 200, stop.
6. Record, enqueue on the sync's queue, answer 202. GitHub gives up after 10 seconds and a git push can take longer.
7. The queue worker runs the matching `sync/*` function, reading the item's current state from both sides rather than trusting the payload, and writes an `activity` row.

### Ordering

- One serial queue per sync, in memory, in one API process. Volume per sync is low and a serial queue rules out races on the same item. `ponytail:` in-memory queues need a single instance; a Postgres-backed job table is the upgrade when one instance is not enough.
- Parents first. A comment or review whose issue or pull request has no link syncs that parent first. A pull request syncs its head and base refs before it is opened. A line comment and a mirrored check run need their commit on the other side, which mirroring the ref guarantees.

### Reconcile

Runs on start and every `RECONCILE_INTERVAL` seconds, for every active sync, one sync at a time (Claude's call: it keeps the per-side rate limits safe). Per sync:

1. List all refs on both sides and apply the Code table to each, including refs deleted on one side since the last run (a ref with a base that is missing on one side).
2. List issues and pull requests updated since `last_reconciled_at` (`since=` on both sides), with their comments, reviews and labels, and pass each to the same `sync/*` function. Check runs and commit statuses for the heads of open pull requests; the default branch's arrive by webhook.
3. The first run (no `last_reconciled_at`) is the First sync above.
4. Check the creator still has admin on both repositories (see Lifecycle).

Reconcile sees ref deletions through the base, but cannot see deleted issues and comments; those rely on webhooks.

## Error handling

- 5xx, 429 and GitHub's secondary rate limit: retry with backoff, honoring `Retry-After`, up to 5 attempts, then log, record an activity error and drop; the next reconcile repairs it. Ghost's rate limits for installation tokens apply per installation (verify against the rate-limiting design); a backfill will hit them.
- 401 / 404 on an installation token or repository: mark the sync `disconnected` (see Lifecycle).
- Other 4xx (parent deleted, line no longer in the diff): record a skipped activity entry and move on.
- Rejected push (protection or a ruleset) or a failed lease: see Code. A rejection is flagged on the ref, not a whole-sync error.
- The queue is lost on restart; the reconcile on start covers it.

## Configuration

Every variable Ghost Sync reads that Ghost also uses carries a `SYNC_` prefix: the monorepo's dev script loads Ghost's root `.env` first, and an unprefixed `DATABASE_URL` once pointed the sync API at Ghost's own database (2026-11-16). `GHOST_API_URL` is shared on purpose: it names the same API.

Environment of `apps/sync/api` (the builder may rename):

| Variable | |
| --- | --- |
| `SYNC_DATABASE_URL` | Ghost Sync's own Postgres |
| `GHOST_WEB_URL` | Ghost's web app, for the "Install on Ghost" link (`/apps/<slug>/installations/new`) |
| `SYNC_AUTH_SECRET`, `SYNC_API_URL` | better-auth's secret and the API's own URL |
| `SYNC_WEB_URL` | For redirects and trusted origins |
| `GHOST_API_URL` | Ghost's API base; REST is under `/api/v3` |
| `GHOST_APP_ID`, `GHOST_APP_SLUG`, `GHOST_APP_PRIVATE_KEY`, `GHOST_APP_CLIENT_ID`, `GHOST_APP_CLIENT_SECRET`, `GHOST_APP_WEBHOOK_SECRET` | The Ghost App |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET` | The GitHub App |
| `SYNC_DATA_DIR` | Bare mirrors, on a volume. Default `/data` |
| `RECONCILE_INTERVAL` | Seconds, default `600` |
| `SYNC_PORT` | |

`apps/sync/web` needs only the API's URL. The API's Dockerfile follows `apps/importer`'s and adds `git`. Bare mirrors grow with the number of syncs; the volume is sized by hand for now.

## Setup (operator, once)

Documented in `apps/sync/README.md`:

1. Register the Ghost App on Ghost with the settings in the table above, the webhook at `<sync-api>/webhooks/ghost`, the callback at better-auth's Ghost callback, and "Request user authorization during installation" on. Generate a private key and a client secret.
2. Register the GitHub App the same way, webhook at `<sync-api>/webhooks/github`.
3. Set the environment, run migrations, deploy both services, add domains.

## Testing

The user writes all the code, end to end, including tests (user decision, 2026-11-09). What must be covered, with `bun test`:

- `format.ts`: marker added and stripped, round trips, no stacking over repeated edits.
- `verify.ts`: valid, invalid and stale signatures on both sides.
- `apps.ts`: JWT claims, token cache reuse and refresh.
- `sync/refs.ts`: every row of the Code table, both directions, against a fake git layer; a failed lease re-compares; nothing is ever force-pushed or deleted unless the other side equals the base.
- `sync/*`: against a fake REST client that records calls. Create when unlinked, update when linked, parent synced first, bot actor skipped, verdict turned into text, pull requests opened on either side, merged on one side closes or merges the other, mirrored check run updated in place, "Sync with GitHub" success and failure.
- Webhook pipeline: dedupe, paused sync dropped, installation events change sync status.
- The new-sync route: refuses repositories where the user is not an admin or the installation does not cover them, refuses a repository already synced.
- First sync: one-sided refs created, differing refs fast-forwarded or flagged, open items copied both ways, GitHub fork pull requests skipped.
- Reconcile: owner losing admin stops the sync.

No end-to-end test in this version.

## Left to the builder

- Table and column names, the web's API shape, the TanStack Start route layout and styling.
- How the GitHub App's name and slug are chosen if `ghost-sync` is taken.
- Whether `apps/sync/db` is its own workspace or lives inside `apps/sync/api`.
