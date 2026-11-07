# Checks API: check runs and check suites for apps

Issue: #79 on Ghost. Builds on commit statuses (`2026-10-16-commit-status-design.md`), rulesets part C (`2026-10-23-rulesets-cd-design.md`) and Ghost Apps (`2026-10-25-ghost-apps-design.md`, slices 1–6, all merged).

The principle of the earlier work carries over: copy GitHub as closely as possible. Where this document is silent, do what GitHub does. Where it says "verify", check against a real GitHub repository before release; if GitHub differs, follow GitHub and update this document.

Claude builds all of it, backend and frontend, test-first (user decision, 2026-11-06). One branch, one pull request.

## Why

A commit status (#16) is one line: a context, a state, a link. The green tick next to a commit, and the list it opens ("lint ✅, tests ❌, Vercel ✅"), is built from those today. Two apps need more than a line:

1. **The CI runner (#42).** It reports each job as a check run that moves from queued to in progress to completed. Its output (summary, log tail) is readable inside Ghost, and annotations mark the failing lines on the pull request diff.
2. **The GitHub sync bot** (`../ghost-sync`, spec `2026-10-14-github-sync-bot-design.md`), in two ways (user decision, 2026-11-06):
   - **Its own health:** one check, such as "Sync to GitHub", that fails when the mirror diverged or a push was rejected. "Re-run" on it means "sync again": the bot pushes Ghost's state out to the clone. A re-run on the GitHub side, which makes Ghost match, is the bot's business. Ghost sees only the resulting push and a new check run.
   - **Mirroring:** it copies the check runs that GitHub's own CI and bots (Actions, CodeRabbit, Vercel) post on the mirror onto the matching Ghost commit. Same name, same conclusion, `details_url` pointing back at GitHub, so Ghost's tick matches GitHub's. A re-run on a mirrored check also goes to the sync bot, which treats it as a resync.

Ghost's job is to store check runs and suites, attribute each to the installation that posted it, show them next to commit statuses, let rulesets require them, and route re-runs and button presses back to the app that owns the run. What an app does with them is not Ghost's concern.

## Goals

1. GitHub's check runs and check suites REST API, on the GitHub compatibility layer, for installation tokens.
2. Check runs carry GitHub's lifecycle, conclusion, output, annotations and up to three action buttons.
3. One suite per app per head commit, created automatically, with re-request.
4. `check_run` and `check_suite` webhook events in `@ghost/webhooks`, under a new `checks` app permission. Re-run, re-request and button events reach only the owning app.
5. Check runs appear wherever commit statuses do today: the merge panel on a pull request, the commit list tick, GraphQL `statusCheckRollup.contexts` (so `gh pr checks` lists both), and the combined state.
6. A ruleset's required check accepts a check run name as well as a status context. `integration_id` pins it to an app, as it already does for statuses.
7. Annotations show inline on the pull request's Files tab.

Nothing in the issue's scope is cut (user decision, 2026-11-06).

## Non-goals

- GitHub Actions, workflows and workflow runs. `CheckSuite.workflowRun` stays null. The CI runner (#42) is a separate project that builds on this.
- GitHub-format webhook payloads. Events use Ghost's format, like every other app event (user decision from Ghost Apps).
- Check suite preferences (`PATCH /repos/:owner/:repo/check-suites/preferences`, turning off auto-creation per app). Answer 404 for now (Claude's call).
- Statuses `waiting`, `requested` and `pending`, which GitHub reserves for Actions. Only `queued`, `in_progress` and `completed` are accepted (as the issue scopes).
- Images in check run output (`output.images`). Accept and ignore the field so GitHub clients do not break (Claude's call).
- A separate Checks tab on the pull request (user decision, 2026-11-06: option B, expand in place).
- Anything the sync bot does. Its mirroring and resync work lives in `../ghost-sync`.

## Anti-goals

- **A check that any user can forge.** Only installation tokens create or update check runs. A personal key, an OAuth key or a user-to-server token gets 403 on create and update, as on GitHub. This is what lets a pinned required check trust a check run.
- **One app editing another app's runs.** An installation can update only runs in its app's suites.
- **Leaking re-runs to other apps.** `rerequested` and `requested_action` go only to the owning app.
- **Breaking commit statuses.** Statuses, their REST endpoints (`/commits/:ref/status`, `/statuses`) and their GraphQL `StatusContext` behave exactly as today. Check runs are added next to them, never merged into status rows.

## Permissions

- New app permission `checks: read | write` in `APP_PERMISSIONS` (`packages/permissions/src/apps.ts`), with GitHub's name. The app registration and install screens list it like the others. Update `apps/web/src/components/apps/permissions.ts`.
- **Create and update** (runs, suites, annotations): an installation token whose installation covers the repository and holds `checks: write`. Anyone else: 403 with GitHub's message (verify the wording).
- **Read:** anyone who can read the repository. An installation needs `checks: read`. Unauthenticated reads of a public repository work, as statuses do.
- **Re-run, re-request and pressing an action button:** a user with write access to the repository, through the web or the REST endpoints. An installation token may also re-request runs of its own app. GitHub allows this; verify.
- GraphQL: the new types join the per-type permission map (`apps/api/src/lib/apps/graphql-permissions.ts`) under `checks: read`. The test that fails on unmapped types covers them.

## Data model

Three tables. Migration via `bun db:generate` at the root; never hand-edit the SQL. Each table gets a `numericId` identity column for the GitHub layer, as `commit_status` does.

**`check_suite`**: one per (repository, head sha, app).
- `repositoryId`, `headSha`, `headBranch` (nullable), `appId` (not null), `installationId` (nullable, set null when the installation is deleted).
- `status` (`queued`, `in_progress`, `completed`) and `conclusion` (nullable), both derived from its runs (below) and stored so lists do not recompute them.
- `before`/`after` shas of the push that created it, nullable, as GitHub returns.
- `createdAt`, `updatedAt`. Unique on (`repositoryId`, `headSha`, `appId`).

**`check_run`**: mutable, unlike statuses. A PATCH updates the row in place.
- `suiteId`, `repositoryId`, `headSha` (denormalised for per-commit queries), `name`.
- `status`, `conclusion`, `startedAt`, `completedAt`.
- `externalId`, `detailsUrl`.
- `outputTitle`, `outputSummary`, `outputText`.
- `actions`: jsonb, at most 3 `{ label, description, identifier }`.
- `createdAt`, `updatedAt`. Index on (`repositoryId`, `headSha`, `name`).

**`check_annotation`**: appended, never replaced.
- `runId`, `path`, `startLine`, `endLine`, `startColumn`, `endColumn` (nullable), `annotationLevel` (`notice`, `warning`, `failure`), `message`, `title`, `rawDetails`.

A deleted app keeps its suites and runs. The app row is soft-deleted, so attribution survives, as for statuses.

## Limits

These are GitHub's numbers. Verify each before release.
- `name`: 1 to 255 characters (Claude's call).
- `output.title`: 255 characters (Claude's call). `output.summary` and `output.text`: 65535 characters each.
- Annotations: at most 50 per request. Send more by repeating PATCH; each request appends.
- Actions: at most 3. `label` up to 20 characters, `description` up to 40, `identifier` up to 20.

Ghost-only caps, Claude's calls:
- At most 1000 check runs per (repository, sha, name), matching `MAX_STATUSES_PER_CONTEXT`.
- At most 1000 annotations per run. The 1001st request answers 422.

## Lifecycle and validation

- Create needs `name` and `head_sha`. The sha must be a commit of the repository, or of a fork with an open pull request into it. This uses the same `holdsCommit` rule as statuses, extracted so both call it.
- `status` defaults to `queued`.
- Sending `conclusion` or `completed_at` implies `status: completed`, as on GitHub. `completed` without a conclusion is 422.
- Once completed, a run can still be updated, as GitHub allows. Its suite's state is recomputed on every change.
- `started_at` defaults to the time of creation.
- Conclusions: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`. `action_required` needs a `details_url` (verify).
- Validation errors answer 422 in GitHub's error shape, through the existing compat filter.

**Suite state from its runs** (verify against GitHub). Only the suite's newest run per name counts. A failed run that was re-run and then passed no longer fails the suite. A suite with no runs is `queued`. While any counted run is not completed, the suite is `in_progress` once any run has started, and `queued` before that. When all counted runs are completed, the conclusion is the worst of their conclusions. The order is `action_required` > `cancelled` > `timed_out` > `failure` > `neutral` > `skipped` > `success`, best last; verify it against GitHub.

`check_suite.completed` fires every time the suite moves into `completed`. A suite that completes, gets a new run and completes again fires it twice, as GitHub does (Claude's call; verify). Re-requesting a suite changes nothing stored. The app answers with new runs, and those move the suite back to `in_progress`.

**Automatic suites.** Two triggers:
- When a branch moves to a new tip, every app whose live installation covers the repository and holds `checks: write` gets a suite for the new tip, plus a `check_suite.requested` event. This is GitHub's auto-trigger, and it is what lets the CI runner start without a push webhook (Claude's call).
  - **"Moves" means every path:** git pushes, web merges of pull requests, branch create and update through the API, and suggestion commits. Each of these is a push on GitHub. Today only git pushes (`git.service.ts`) publish `push`, so the hook goes in one place that every ref update passes through, not in each caller. The builder finds or makes that place. The existing `push` webhook gaps on the other paths are out of scope unless the same place fixes them for free.
  - **Not covered:** tag updates and branch deletions create no suite (Claude's call; verify that GitHub does the same for tags).
  - **Fork pull requests:** the suite belongs to the repository the commit was pushed to. An app on the base repository gets no suite for a fork head. It learns of the fork head from `pull_request.opened` and `pull_request.synchronized`, and creates its runs on the base repository, which `holdsCommit` allows. This copies GitHub (verify).
- Creating a check run on a sha where the app has no suite yet creates one.

`POST /repos/:owner/:repo/check-suites` creates one explicitly, as on GitHub.

**Re-run.** GitHub semantics:
- Re-requesting a run does not reset it. It sends `check_run.rerequested` to the owning app, which then creates a new run with the same name.
- Re-requesting a suite sends `check_suite.rerequested`.
- A run's "current" state on a commit is the newest run per (app, name).

## Combined state

A check run counts in the commit's combined state as follows.
- `queued` or `in_progress`: pending.
- `success`, `neutral` or `skipped`: passing.
- `failure`, `cancelled`, `timed_out` or `action_required`: failing.

The newest run per (app, name) is the one that counts. The tick, the merge panel summary and GraphQL `statusCheckRollup.state` combine these with statuses through the existing `combinedState` rules.

The GitHub REST `/commits/:ref/status` stays statuses only, as on GitHub.

The fork rule from statuses carries over. For display, the pull request rollup reads the base and head repositories. Rulesets and `isRequired` read the base only.

## Rulesets

A required check `{ context, integration_id? }` is satisfied by the newest result matching `context`. A match is either a status with that context or a check run with that name. With `integration_id`, only results from that app count.
- A status matches only when its state is `success`.
- A check run matches only when it is completed with `success`, `neutral` or `skipped` (verify).

Statuses and check runs are merged newest first into `RefFacts.statuses` (renamed if a clearer name fits). `evaluate-rulesets.ts` then needs no new branch.
- A run's time is its `completedAt`, falling back to `updatedAt`.
- A run maps to the same three states as in the combined state above.

The violation message keeps its form: `Required status check "x" is failure.`

The ruleset form's context suggestions (`CommitStatusesService.contexts`) include check run names.

Mirrored checks are attributed to the sync bot. Pinning `integration_id` to the sync bot therefore trusts whatever it mirrored. That is intended: the bot's installation is the only thing that can post as it.

## Webhook events

The events join `WEBHOOK_EVENTS` in `@ghost/webhooks` with permission `checks`, in Ghost's format:

| Event | Fired when | Delivered to |
|---|---|---|
| `check_run.created` | a run is created | subscribed repository and organization webhooks, and subscribed apps with `checks: read` |
| `check_run.completed` | a run first becomes completed | same as above |
| `check_run.rerequested` | someone re-runs it | the owning app only |
| `check_run.requested_action` | someone presses one of its action buttons; the payload carries `requested_action.identifier` | the owning app only |
| `check_suite.completed` | all of a suite's runs are completed | subscribed webhooks and apps, as for `check_run.created` |
| `check_suite.requested` | a suite is created automatically by a push | the owning app only |
| `check_suite.rerequested` | someone re-runs all of it | the owning app only |

The owning-app-only events are not subscribable, like the installation events. They reach the app whatever it subscribed to, as long as it holds `checks` (Claude's call; GitHub's apps subscribe to `check_run` as a whole, which Ghost's per-action names cannot mirror).

Payloads carry the run or suite (with the app slug and the run's output title), the repository, the sender, and `installation.id` for app deliveries. The internal `EventPayloads` entries go in `apps/api/src/lib/events/events.ts`. The `satisfies` check ties them to the webhook list.

Chat-format renderers (Discord, Slack, `lib/webhooks/formats/`) render the created and completed events. The owning-app-only events never reach chat-format endpoints, since only app endpoints receive them.

## GitHub REST (compat layer, `apps/api/src/github/rest/checks/`)

GitHub's paths, request bodies and response shapes:
- `POST /repos/:owner/:repo/check-runs`
- `GET` and `PATCH /repos/:owner/:repo/check-runs/:id`
- `GET /repos/:owner/:repo/check-runs/:id/annotations`
- `POST /repos/:owner/:repo/check-runs/:id/rerequest`
- `GET /repos/:owner/:repo/commits/:ref/check-runs`, with `check_name`, `status` and `filter=latest|all` (default `latest`, meaning newest per name and app)
- `GET /repos/:owner/:repo/commits/:ref/check-suites`, with `app_id` and `check_name`
- `POST /repos/:owner/:repo/check-suites`
- `GET /repos/:owner/:repo/check-suites/:id`
- `GET /repos/:owner/:repo/check-suites/:id/check-runs`
- `POST /repos/:owner/:repo/check-suites/:id/rerequest`

`app` in the responses uses the app object the compat layer already returns for installations. Pagination follows the existing compat helpers.

## Ghost REST API (`/api/v1`, for the web)

- **The checks of a commit**, newest run per (app, name), each with:
  - its app (slug, name, avatar)
  - status, conclusion, timestamps, output and actions
  - the number of its annotations

  The pull request DTO's `checks` gains the check runs of the head commit next to its statuses. The combined state then covers both, and the merge panel needs one request. The commit list's per-commit combined state includes check runs.
- **One run's annotations**, paged.
- **The annotations of a pull request's head commit**, for the Files tab: newest runs only, grouped by path.
- **Re-run a run, re-run an app's suite, press an action button.** Write access needed.

OpenAPI types regenerate from the API. Run `bun run openapi` against a throwaway DB, not `.env`'s dev DB.

## GraphQL

Replace the placeholders in `placeholders.type.ts` with real `CheckRun` and `CheckSuite` nodes:
- `CheckRun`: name, status, conclusion, startedAt, completedAt, detailsUrl, title, summary, text, `annotations` (connection), `checkSuite`, `isRequired(pullRequestNumber:)`, plus the fields `gh pr checks` and `gh run` query (verify against gh's queries).
- `CheckSuite`: `app`, status, conclusion, `checkRuns`, and `workflowRun: null`.

`statusCheckRollup` lists `CheckRun` and `StatusContext` nodes together in `contexts`. It is null only when the commit has neither. Node ids decode through `node-lookup.ts`, so `node(id:)` works.

Update the placeholders file's header comment, since check runs are no longer placeholders.

## Web

Decisions from the mockups (user decision, 2026-11-06: option B):

- **Merge panel (`commit-checks.tsx`).** Check runs and statuses go into one list.
  - It keeps today's summary line ("1 failing, 1 pending, 4 successful checks"), failing-first order and open-while-not-passing behaviour.
  - A check run row shows its status icon, "app / name", the Required badge and the output title.
  - Clicking a run row expands it in place. The expansion shows the summary and text as markdown, with the renderer the repository already uses for comments. It also shows the annotations as `path:line` plus the message, a Re-run button, the action buttons, and "Details ↗" when `detailsUrl` is set.
  - Status rows stay as they are.
  - In-progress runs show a distinct icon from queued ones (Claude's call).
- **Re-run all.** Each app's group of runs gets a small "Re-run all" for its suite, beside the app's first row (Claude's call). There is no separate suite view.
- **Commit list.** The tick next to each commit combines statuses and check runs and opens the same expandable list, so a commit on main shows the same view as a pull request.
- **Files tab.** Annotations on lines shown in the diff render under the line, coloured by level, labelled "app / run". Annotations on paths or lines outside the diff appear only in the run's expanded output.
- **Mirrored checks** look like any other run under the sync bot. They get no special badge (Claude's call).
- **Re-run and action buttons** render only for viewers with write access.

Check the UI in the user's logged-in Chrome at `localhost:3000` (memory: ui-testing-chrome).

## Tests

- API unit and e2e, as earlier slices did. They cover:
  - every validation and limit
  - token type refusals: PAT, OAuth key and user-to-server get 403
  - an app updating another app's run
  - suite state derivation and automatic suites on push
  - each webhook event and its audience
  - the combined state mix
  - rulesets with runs, pinned and unpinned, including the fork rule
  - the GraphQL rollup
  - REST response shapes against GitHub's documented examples
- `@ghost/webhooks` and `@ghost/permissions` tests pick up the new entries.
- Integration specs need `TEST_DATABASE_URL`. Run the full suite only on a throwaway Postgres, never on 192.168.1.4.

## Left to the builder

- Column names, module and service layout, within `docs/code-standards.md`. For example: a `resources/checks` module for Ghost's API, `github/rest/checks` for the compat layer, and a shared service both call.
- Whether `holdsCommit` moves to `lib/` or to a small shared service.
- How the owning-app-only delivery is added to `WebhookFanoutService`. It needs a path that targets one app's endpoint, much like `installationEvent`.
- Exact GitHub response fields. Follow GitHub's REST docs and keep what gh and Octokit read.
