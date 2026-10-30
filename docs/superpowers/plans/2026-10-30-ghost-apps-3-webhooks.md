# Ghost Apps 3: App Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Who does what:** Claude implements all of this slice, backend and frontend, test-first (user decision, 2026-10-30). Every task writes its tests, runs them red, implements, and runs them green.

**Goal:** A Ghost App gets the events it subscribed to, from every repository its live installations cover, filtered by the permissions and events each owner accepted, with `installation: { id }` in every body. It also gets lifecycle events for its installations. Pull requests get their own `pull_request.opened/edited/closed/reopened` events. Every list of webhook events in the codebase comes from one package.

**Architecture:**
- **One event table:** the new package `@ghost/webhooks` (`packages/webhooks`) holds every subscribable event with its picker label and the app permission it needs, plus the installation events. The API's DTO enum, the web picker, the app form's event filter and `appPermissionsProblem` all read it. `EVENT_PERMISSIONS` leaves `@ghost/permissions`.
- **PR split at the webhook layer:** internal events stay as they are (`issue.opened` and the rest fire for pull requests too). `WebhookFanoutService.handle` loads the thread first. Then `webhookEventOf(type, isPullRequest)` names the webhook event, and the endpoint query and body use that name. Chat formats render the new names.
- **App endpoint = a `webhook_endpoint` row** with `app_id`. `apps/delivery` and its signing, retries and 410 auto-disable work unchanged. The breaker's sweep also works unchanged; its email learns about app owners. `app.webhook_url` and `app.webhook_secret` are dropped. `AppsService` keeps the row in step with the app form.
- **Fan-out:** after the repository and organization endpoints, `handle` finds app endpoints through `installationCovers(repository)` (`lib/repositories/access/repository-access.ts`), filtered by suspension, the accepted `events`, and the accepted `permissions` via `grants`. Each app body is the repository body plus `installation: { id: numericId }`.
- **Installation events:** `InstallationsService` enqueues them through `WebhookFanoutService.enqueue`, inside the same transaction as the change.

**Tech Stack:** NestJS 11, Drizzle, vitest + supertest, bun test (packages), Next.js 16 + next-safe-action.

**Spec:** `docs/superpowers/specs/2026-10-25-ghost-apps-design.md`. Read "Slice 3" and "Slice 3 decisions".

**Branch:** `feat/ghost-apps-3`, cut from `main` at 5e9568c. It already holds the spec commit 3d0f452.

## Global Constraints

- Webhook bodies stay in Ghost's format: `noun.verb` names, camelCase keys, the `X-Ghost-*` headers. Nothing about GitHub's format gets added.
- Pull request lifecycle: a pull request sends `pull_request.opened`, `pull_request.edited`, `pull_request.closed`, `pull_request.reopened`, never the `issue.*` four. A merge keeps sending `pull_request.merged` only, as today: there is no `pull_request.closed` on merge. Labels, assignees and comments keep `issue.*` names for both, with the `pullRequest` key set.
- Existing endpoints get no migration of their `events` (user decision). An endpoint subscribed to `issue.opened` stops getting pull request opens.
- An app receives a repository event only when every one of these holds: the app endpoint is `active`; `app.deleted_at` is null; an installation of that app covers the repository (`installationCovers`); `suspended_at` is null; the installation's `events` contain the webhook event name; and `grants(installation.permissions, EVENT_PERMISSION, 'read')` is true.
- `installation.id` in every app body is `app_installation.numeric_id`, the id `POST /app/installations/:id/access_tokens` takes.
- Installation events go to the app endpoint whatever the app subscribed to, but only if the endpoint exists and is active. They are never sent to repository or organization endpoints. `installation.deleted` is the last event an installation sends. While an installation is suspended, it sends nothing except `installation.unsuspended`.
- An app's webhook URL goes through `webhookUrlProblem` (SSRF check), like any endpoint. A URL needs a secret: `422 "A webhook URL needs a secret"` when the app would end up with a URL and no secret (Claude's call: the delivery service cannot sign without one, and GitHub's unsigned option isn't worth a nullable column).
- Code standards (`docs/code-standards.md`): pure functions under `lib/`, injectables under `services/`, controllers only pass through, one `@Controller` per file, no one- or two-line helpers, no wrapped strings.
- Migrations: run `bun db:generate` at the root. Never hand-edit the SQL.
- Integration specs need `TEST_DATABASE_URL` pointed at a throwaway Postgres (memory: dev DB is not a test DB). `$INT` means `TEST_DATABASE_URL=postgres://...@localhost:55433/... npx vitest run`, and `$E2E` means the slice 2 e2e command. Both run from `apps/api`.
- OpenAPI: regenerate `apps/api/openapi.json` against the throwaway DB, not `.env`'s dev DB, then run `bun run --filter @ghost/web generate`.

## Review Focus

1. **Two installations of the same app reaching the same repository can't happen** (one installation per app and account, and a repository has one owner account). But a repository transferred out of an installation's account keeps its `app_installation_repository` row. `installationCovers` must still exclude it. Test in Task 4 (`does not send a transferred repository's events to the old account's installation`).
2. **An app whose owner lowered a permission after install.** The installation snapshot is lowered by `lowerInstallations`, so the fan-out must read the installation's snapshot, never `app.permissions` or `app.events`. Test in Task 4 (`filters by the installation's accepted set, not the app's`).
3. **A pull request event on an endpoint subscribed to both `issue.opened` and `pull_request.opened`.** It must be delivered once, as `pull_request.opened`. Test in Task 2.
4. **Switching an installation from `all` to `selected`.** The app must get `installation.repositories_removed` listing every account repository not kept, and nothing for a no-op update. Test in Task 5.
5. **Uninstall then reinstall of the same app on the same account.** That gives a new `numericId`. Old jobs must keep the old id in their frozen bodies, and new events carry the new one. Test in Task 5 (`reinstall gets a new installation id`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/webhooks/` (`package.json`, `tsconfig.json`, `src/index.ts`, `src/index.spec.ts`) | `WEBHOOK_EVENTS` table, `webhookEvents` tuple, `WebhookEvent`, `INSTALLATION_EVENTS`, `InstallationEvent` |
| `packages/permissions/src/apps.ts` | Loses `EVENT_PERMISSIONS` |
| `apps/api/src/lib/webhooks/webhooks.ts` | Re-exports the tuple, `webhookEventOf`, `WebhookOwner` gains the app case, `WebhookBody` gains `installation` |
| `apps/api/src/lib/webhooks/formats/message.ts` | Chat lines for the new pull request events |
| `apps/api/src/lib/apps/permissions.ts` | `appPermissionsProblem` reads `WEBHOOK_EVENTS` |
| `apps/api/src/services/webhooks/webhook-fanout.service.ts` | PR split, app fan-out, `installation` events body |
| `apps/api/src/services/webhooks/webhook-breaker.service.ts` | Emails app owners |
| `apps/api/src/mail/mail.service.ts` | `sendWebhookDisabledEmail` takes `settingsPath` |
| `packages/db/src/schema/webhooks.ts`, `apps.ts` | `webhook_endpoint.app_id`, new check; drop `app.webhook_url`, `app.webhook_secret` |
| `apps/api/src/lib/apps/delete-apps.ts` | Deletes the app's endpoint |
| `apps/api/src/resources/apps/apps.service.ts`, `dto/app.dto.ts`, `apps.controller.ts` | Endpoint sync, webhook fields on `AppDTO`, webhook routes |
| `apps/api/src/resources/installations/installations.service.ts` | Enqueues installation events |
| `apps/web/src/lib/webhooks.ts`, `components/webhooks/*` | Labels from the package, `app` owner kind |
| `apps/web/src/components/apps/app-fields.tsx`, `app-webhook.tsx` (new), app detail pages | Event filter from the package, Webhook section |

---

### Task 1: `@ghost/webhooks`, the one list of events

**Files:**
- Create: `packages/webhooks/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.spec.ts` (shape copied from `packages/permissions`)
- Modify: `packages/permissions/src/apps.ts` (remove `EVENT_PERMISSIONS`), `apps/api/package.json`, `apps/web/package.json` (add `"@ghost/webhooks": "workspace:*"`), `apps/api/src/lib/webhooks/webhooks.ts`, `apps/api/src/lib/apps/permissions.ts`, `apps/api/src/lib/apps/permissions.spec.ts`, `apps/web/src/lib/webhooks.ts`, `apps/web/src/components/apps/app-fields.tsx`, `apps/api/openapi.json`, `apps/web/src/lib/api/v1.d.ts`
- Check: the API's Dockerfile or the turbo pipeline, if it lists workspace packages by name

**Interfaces:**
- Produces:
  - `WEBHOOK_EVENTS: { readonly [E in WebhookEvent]: { label: string; permission: AppPermission } }`. Insertion order is the picker order.
  - `webhookEvents: readonly [WebhookEvent, ...WebhookEvent[]]`
  - `type WebhookEvent`
  - `INSTALLATION_EVENTS = ['installation.created', 'installation.deleted', 'installation.suspended', 'installation.unsuspended', 'installation.repositories_added', 'installation.repositories_removed'] as const`
  - `type InstallationEvent`
- The table is today's `webhookEvents` order plus `pull_request.opened`, `pull_request.edited`, `pull_request.closed`, `pull_request.reopened` (all `pull_requests`) placed before `pull_request.ready_for_review`. Labels come from `apps/web/src/lib/webhooks.ts`, with the four `issue.*` lifecycle labels narrowed to issues ("An issue is opened", and so on). New labels: "A pull request is opened", "A pull request's title or description is edited", "A pull request is closed without merging", "A pull request is reopened".

- [ ] **Step 1: Write the failing tests.** In `packages/webhooks/src/index.spec.ts`:
  - `every event has a label and a permission from APP_PERMISSIONS`
  - `has the pull request lifecycle events with pull_requests`
  - `no installation event is subscribable` (`INSTALLATION_EVENTS` ∩ `webhookEvents` = ∅)
  - `webhookEvents follows the table's order`

  In `apps/api/src/lib/apps/permissions.spec.ts`, replace the `EVENT_PERMISSIONS` describe with `appPermissionsProblem refuses an installation event` (`['installation.created']` gives `"installation.created is not an event"`) and `refuses pull_request.opened without pull_requests`.
- [ ] **Step 2: Run red.** Run `bun test` in `packages/webhooks`, then `npx vitest run src/lib/apps/permissions.spec.ts` in `apps/api`. Expected: FAIL, missing module.
- [ ] **Step 3: Implement.**
  - Build the package.
  - `apps/api/src/lib/webhooks/webhooks.ts` re-exports `webhookEvents` and `WebhookEvent` from `@ghost/webhooks`. It replaces its `satisfies readonly EventType[]` with a type assertion that `Exclude<WebhookEvent, 'pull_request.opened' | 'pull_request.edited' | 'pull_request.closed' | 'pull_request.reopened'>` extends `EventType`.
  - `appPermissionsProblem` uses `Object.hasOwn(WEBHOOK_EVENTS, event)` and `.permission`.
  - Web `webhookEventLabels` becomes a projection of `WEBHOOK_EVENTS`, typed by the package's `WebhookEvent`. `app-fields.tsx` `covers` reads `WEBHOOK_EVENTS[event]?.permission`.
  - Regenerate OpenAPI and the web types.
- [ ] **Step 4: Run green.** The package tests and the API unit specs pass. `bun check-types` passes at the root. `grep -rn "EVENT_PERMISSIONS" apps packages --exclude-dir=node_modules` finds nothing.
- [ ] **Step 5: Commit.** "Move webhook events into @ghost/webhooks and add pull request lifecycle events"

### Task 2: Pull requests send their own lifecycle events

**Files:**
- Modify: `apps/api/src/lib/webhooks/webhooks.ts`, `apps/api/src/services/webhooks/webhook-fanout.service.ts`, `apps/api/src/lib/webhooks/formats/message.ts`
- Test: `apps/api/src/lib/webhooks/webhooks.spec.ts`, `apps/api/src/lib/webhooks/formats/formats.spec.ts`, `apps/api/src/resources/webhooks/webhooks.integration.spec.ts`

**Interfaces:**
- Produces:
  - `webhookEventOf(type: EventType, isPullRequest: boolean): WebhookEvent | EventType`. For a pull request it maps `issue.opened|edited|closed|reopened` to `pull_request.*`; every other type passes through unchanged.
  - `WebhookBody.event: WebhookEvent | EventType | InstallationEvent | 'ping'`.

- [ ] **Step 1: Write the failing tests.**
  - `webhooks.spec.ts`: `webhookEventOf maps the four lifecycle events of a pull request` (each of the four), `leaves an issue's events alone`, `leaves issue.labeled and issue.commented alone on a pull request`.
  - `formats.spec.ts`: Slack, Discord, Teams and Google Chat render `pull_request.opened` as `opened <pull request about>` with the body, and render closed, reopened and edited the way their `issue.*` twins do.
  - Integration:
    - `sends a pull request's open as pull_request.opened, and not to an endpoint that only chose issue.opened`. Build a PR row (`isPullRequest: true`) and two endpoints, one with `['issue.opened']` and one with `['pull_request.opened']`. Assert zero jobs on the first, and on the second one job whose `payload.event` and `body.event` are both `pull_request.opened`, with `body.pullRequest.number` set.
    - `delivers once to an endpoint subscribed to both names` (Review Focus 3).
    - `still sends issue.opened for an issue`.
- [ ] **Step 2: Run red.** Run `npx vitest run src/lib/webhooks` and `$INT src/resources/webhooks`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `handle`, read the thread first when the payload has `issueId`. Compute `name = webhookEventOf(event.type, thread.isPullRequest)`, then use `name` in `arrayContains` and in `body.event`. `bodyOf` takes the already-loaded thread instead of querying it again. In `message.ts`, add the four `pull_request.*` cases next to their `issue.*` twins.
- [ ] **Step 4: Run green.** Same commands, PASS.
- [ ] **Step 5: Commit.** "Send pull request lifecycle events under pull_request.*"

### Task 3: An app's webhook is a `webhook_endpoint` row

**Files:**
- Modify: `packages/db/src/schema/webhooks.ts` (`appId: text().references(() => app.id, { onDelete: 'cascade' })`, index `webhook_endpoint_app_idx` unique on `app_id`, check `num_nonnulls(repository_id, organization_id, app_id) = 1`), `packages/db/src/schema/apps.ts` (drop `webhookUrl`, `webhookSecret`), generated migration
- Modify: `apps/api/src/lib/webhooks/webhooks.ts` (`WebhookOwner` gains `| { appId: string; name: string }`), `apps/api/src/resources/webhooks/webhooks.service.ts` (`ownedBy` app branch), `apps/api/src/services/webhooks/webhook-fanout.service.ts` (`ping` body carries `app: { slug }` for an app owner)
- Modify: `apps/api/src/resources/apps/apps.service.ts`, `dto/app.dto.ts`, `apps.controller.ts`, `apps.module.ts` (import `WebhooksModule`), `apps/api/src/lib/apps/delete-apps.ts`, `apps/api/src/lib/apps/apps.errors.ts`
- Modify: `apps/api/src/services/webhooks/webhook-breaker.service.ts`, `apps/api/src/mail/mail.service.ts` and its template
- Test: `apps/api/test/apps.e2e-spec.ts`, `apps/api/src/resources/webhooks/webhooks.integration.spec.ts`

**Interfaces:**
- Consumes: `WebhooksService.ping/deliveries/redeliver(owner, webhookId, ...)`, `webhookUrlProblem`, `sealWebhookSecret`.
- Produces:
  - `AppDTO` gains `webhookActive: boolean`, `webhookDisabledReason: string | null`, `webhookId: string | null`. `webhookUrl` and `webhookSecretSet` are now read from the row.
  - `UpdateAppDTO.webhookActive?: boolean`. Turning it back on clears `disabledReason` and `disabledNotifiedAt`, as `WebhooksService.update` does.
  - Routes on `apps.controller.ts`, owner only, 404 otherwise:
    - `GET apps/:slug/webhook/deliveries` returns `ListDeliveriesResponseDTO`
    - `POST apps/:slug/webhook/deliveries/:deliveryId/redeliveries` returns 204
    - `POST apps/:slug/webhook/pings` returns 204
  - Error `AppWebhookSecretRequiredError`, `422 "A webhook URL needs a secret"`.
  - `sendWebhookDisabledEmail(to, { name, owner, url, reason, settingsPath })`. The repository and organization paths are built by the breaker, as today. For an app it is `/settings/apps/:slug`, or `/:org/settings/apps/:slug`.

- [ ] **Step 1: Write the failing tests.** In `apps.e2e-spec.ts`:
  - `creating an app with a webhook URL creates its endpoint, subscribed to nothing directly, and pings it`. The endpoint row has `app_id`, and `events` is `[]` (the installation snapshot decides what is sent). One `ping` job.
  - `refuses a webhook URL without a secret` (422 message).
  - `refuses a private-network webhook URL` (422 from `webhookUrlProblem`).
  - `clearing the URL deletes the endpoint, and changing it keeps the endpoint id`.
  - `webhookActive false turns the endpoint off, true turns it back on and clears the disabled reason`.
  - `lists deliveries and redelivers for the owner, 404 for anyone else`.
  - `deleting the app deletes its endpoint`.

  In the integration spec: `emails an app's owner, with a link to the app's settings, when its endpoint is turned off`.
- [ ] **Step 2: Run red.** Run `$E2E test/apps.e2e-spec.ts` and `$INT src/resources/webhooks`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Schema, then `bun db:generate`.
  - `AppsService.create` and `update` upsert or delete the row in the same transaction as the app write, after `webhookUrlProblem`. `secret` is kept when the update leaves it unset.
  - `deleteApps` deletes `webhook_endpoint` where `app_id` is in the deleted ids: soft delete never fires the FK cascade.
  - The breaker's `ownerId` coalesce gains `app_id`, plus a third recipient query: an app's owner user, or its organization's admins.
- [ ] **Step 4: Run green.** Same commands, PASS. `$E2E test/apps-installations.e2e-spec.ts test/apps-identity.e2e-spec.ts` stays green.
- [ ] **Step 5: Commit.** "Keep an app's webhook as a webhook_endpoint row"

### Task 4: Fan repository events out to installed apps

**Files:**
- Modify: `apps/api/src/services/webhooks/webhook-fanout.service.ts`, `apps/api/src/lib/webhooks/webhooks.ts` (`WebhookBody.installation?: { id: number }`)
- Test: `apps/api/src/resources/webhooks/webhooks.integration.spec.ts` (new `describe('app endpoints')`, with an app, its bot user, endpoint and installations built from rows)

**Interfaces:**
- Consumes: `installationCovers(repository)`, `grants(held, permission, 'read')` from `lib/apps/permissions.ts`, `WEBHOOK_EVENTS[name].permission`.
- Produces: an app job body is the repository body plus `installation: { id: numericId }`, rendered with `renderWebhookBody` like any other. Its idempotency key is `${event.id}:${endpoint.id}`, the same as today.

- [ ] **Step 1: Write the failing tests.**
  - `sends an event on an installed repository with installation.id` (selection `all`; `body.installation.id` equals `numericId`).
  - `sends a selected repository's events and not another repository's of the same account`.
  - `sends nothing for a repository outside the installation's account`.
  - `sends nothing while suspended, for a deleted app, or to an inactive endpoint`.
  - `filters by the installation's accepted set, not the app's` (Review Focus 2). The app has `events: ['push','issue.opened']`, while the installation accepted `['push']`. An `issue.opened` sends nothing and a `push` sends.
  - `needs the event's permission at read` (an installation `events` containing `issue.opened` but `permissions` without `issues` sends nothing).
  - `sends pull_request.opened to an app that accepted it` (end-to-end with Task 2).
  - `does not send a transferred repository's events to the old account's installation` (Review Focus 1).
  - `repository webhook bodies carry no installation key`.
- [ ] **Step 2: Run red.** `$INT src/resources/webhooks`. Expected: FAIL.
- [ ] **Step 3: Implement.** Second query in `handle`: select `webhookEndpoint.id`, `url`, `appInstallation.numericId` and `appInstallation.permissions`. It runs from `repository`, inner-joined to `appInstallation` on `installationCovers`, to `app` (not deleted), and to `webhookEndpoint` on `app_id` (active), where `suspendedAt` is null and `arrayContains(appInstallation.events, [name])`. Filter on `grants` in TypeScript. Then build the body once and spread `installation` into each app job.
- [ ] **Step 4: Run green.** Same command, PASS.
- [ ] **Step 5: Commit.** "Deliver repository events to installed apps with installation.id"

### Task 5: Installation lifecycle events

**Files:**
- Modify: `apps/api/src/resources/installations/installations.service.ts`, `installations.module.ts` (provide or import `WebhookFanoutService`), `apps/api/src/services/webhooks/webhook-fanout.service.ts`, `apps/api/src/lib/webhooks/webhooks.ts`
- Test: `apps/api/test/apps-installations.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `WebhookFanoutService.installationEvent(tx: Executor, installationId: string, event: InstallationEvent, sender: string, repositoryIds?: string[]): Promise<void>`. It reads the installation, its app endpoint and the account. It does nothing without an active endpoint. Otherwise it inserts one job through `tx`.
  - Body: `{ event, installation: { id, account: { login, kind: 'user' | 'organization' }, repositorySelection, permissions, events }, repositories?: { id, fullName }[], sender: UserRef, createdAt }`. The idempotency key is `installation:${installationId}:${event}:${randomUUID()}`.
- Call sites, all inside each method's transaction:
  - `install`: `installation.created`, with the selected repositories, or none for `all`.
  - `update`: compute added and removed from the before and after covered sets. `all` to `selected` removes every account repository not kept. `selected` to `all` adds every account repository not already selected. Send `repositories_added` and/or `repositories_removed` only when non-empty.
  - `suspend`: `installation.suspended`.
  - `unsuspend`: `installation.unsuspended`, sent after `suspended_at` clears.
  - `uninstall`: `installation.deleted`, enqueued before the row is deleted. Its body is frozen at enqueue, so the cascade on `delivery_job.endpoint_id` doesn't apply: the endpoint belongs to the app and survives.
  - The sweep is irrelevant here. `enqueue` already ends with `NOTIFY delivery`, so `installationEvent` issues it on `tx`.

- [ ] **Step 1: Write the failing tests.** In `apps-installations.e2e-spec.ts`, against an app with a webhook URL:
  - `install sends installation.created with the installation id and its repositories`
  - `adding and removing selected repositories sends repositories_added and repositories_removed`
  - `switching to selected lists the repositories removed` (Review Focus 4)
  - `an update that changes nothing sends nothing`
  - `suspend and unsuspend send their events, and nothing else is sent while suspended`
  - `uninstall sends installation.deleted last`
  - `reinstall gets a new installation id` (Review Focus 5)
  - `an app without a webhook URL gets no jobs`
- [ ] **Step 2: Run red.** `$E2E test/apps-installations.e2e-spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Per the call sites above.
- [ ] **Step 4: Run green.** Same command, PASS. `$E2E test/github-installations.e2e-spec.ts` stays green.
- [ ] **Step 5: Commit.** "Send installation lifecycle events to the app"

### Task 6: Web: Webhook section on the app, new event labels

**Files:**
- Modify: `apps/web/src/lib/webhooks.ts` (`webhookOwnerSchema` gains `{ kind: 'app', slug }`), `apps/web/src/components/webhooks/actions.ts` (`pingWebhook` and `redeliverWebhook` route the app kind to the Task 3 paths; the other actions refuse it in the schema), `apps/web/src/components/webhooks/webhook-deliveries.tsx` (unchanged API, takes the app owner)
- Create: `apps/web/src/components/apps/app-webhook.tsx`, holding the disabled alert, an Active switch (calls the app update action with `webhookActive`) and `WebhookDeliveries`
- Modify: `apps/web/src/app/settings/apps/[slug]/page.tsx`, `apps/web/src/app/[username]/settings/apps/[slug]/page.tsx` (fetch deliveries when `webhookId` is set; render `AppWebhook` under the app settings), `apps/web/src/components/apps/actions.ts`

- [ ] **Step 1: Check types red.** Run `bun run check-types` in `apps/web` after regenerating `v1.d.ts`. Expected: FAIL where `webhookUrl` was read off the old shape, and on the picker.
- [ ] **Step 2: Implement.** Picker and app form labels already come from Task 1. Copy for the section: title "Webhook", description "Deliveries of the events this app's installations accepted, with `installation.id` in every body." Show nothing when `webhookUrl` is null.
- [ ] **Step 3: Verify.** `bun run check-types` and `bun run lint` pass in `apps/web`. Then view the app page in a browser on a second port, or, if the user's dev server holds :3000 (slice 1 note), ask the user to look. Cover: the deliveries list, redeliver, the Active toggle, and the picker showing the four new events.
- [ ] **Step 4: Commit.** "Show an app's webhook deliveries on its settings page"

### Task 7: Finish

- [ ] **Step 1:** Run every verification: `bun check-types`, `bun run lint` (it runs `check-standards`), `bun test` in `packages/webhooks`, `$INT src/resources/webhooks src/lib src/services`, and the whole `$E2E` suite. Compare the e2e failures with the known ones in memory.
- [ ] **Step 2:** Run the "Done when" check from the spec by hand, once, against the throwaway stack. Steps: register an app with a webhook URL pointing at a local receiver (`bunx http-echo` or a 10-line Bun server), install it on one selected repository, push, open a PR, add a repository, suspend, unsuspend and uninstall. Confirm the receiver logs each event, that the PR and the push carry `installation.id`, and that a push to a repository outside the installation sends nothing.
- [ ] **Step 3:** Push to both remotes. Open Ghost PR "Closes #105" and GitHub PR "Part of #109", cross-linked (dual-PR workflow). Note in both bodies: the break for existing subscribers, the dropped `app.webhook_*` columns, and the new migration, which is still unrun.
- [ ] **Step 4:** After merge, comment on Ghost #79 that apps exist, and that check runs should be attributed to installations the way statuses are.
