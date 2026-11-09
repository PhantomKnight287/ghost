# Delete issues — design

Ghost #135 · GitHub #165 · 2026-11-09

## Why

Ghost cannot delete an issue. No route exists in Ghost's own API or in the
GitHub compatibility layer, and no `issue.deleted` event exists. This blocks
sync.ghost (`2026-11-09-sync-ghost-design.md`): an issue deleted on GitHub has
nothing to map to on Ghost, and Ghost never produces a deletion to send back.

The fix copies GitHub.

## Goals

- A repository admin (or an owner or admin of the owning organization) deletes
  an issue from the web UI, after a confirmation.
- GraphQL `deleteIssue(input: { issueId, clientMutationId })`, with GitHub's
  input and payload (`DeleteIssuePayload { clientMutationId, repository }`).
  `gh issue delete` works against Ghost as a result.
- Ghost App installation tokens with `issues: write` can call `deleteIssue`.
- A new `issue.deleted` event, delivered to repository webhooks and to app
  installations subscribed to it, needing the `issues` permission.
- Deletion is permanent. An issue's number is never given out again.

## Non-goals

- No restore, undo, soft delete, tombstone or trash.
- No audit log entry. Ghost has no audit log yet.
- No REST route in the GitHub compatibility layer. GitHub has none.
- No bulk delete.
- No notification to anyone when an issue is deleted. GitHub sends none.

## Anti-goals

- Anything of the issue still readable after the request succeeds: its page,
  its row in lists, search results, timelines, notifications, or GraphQL
  nodes.
- A deleted issue's number reused by a later issue or pull request.
- A pull request deleted through any route.
- A user below admin, or a bot without `issues: write`, deleting anything.

## Decided behaviour

### Who may delete

- People: the `admin` repository operation in
  `lib/repositories/access/repository-access.ts` (repository admins,
  organization owners and admins through the role ladder, ADR 0021/0023).
  Write, triage and read are refused.
- App bots: `installationRoleOf` only ever grants a bot `write`, so the admin
  check alone would refuse every bot. A bot acting through an installation
  token may delete when the installation grants `issues: write`
  (`'Mutation.deleteIssue': { issues: 'write' }` in
  `lib/apps/graphql-permissions.ts`) and the installation covers the
  repository. The bot needs no repository admin role. A token without
  `issues: write`, or narrowed to other repositories, is refused.
- User-to-server (`ghu_`) tokens get the intersection, as everywhere else in
  Ghost and on GitHub: the user must be an admin and the app must hold
  `issues: write`. The bot rule applies only when the actor is an app's bot
  acting through an installation token. A write collaborator acting through
  an app is refused. *(Claude's call.)*
- The shared service method takes the requester as today. It authorizes with
  the `admin` operation, except when the requester is an app bot, where it
  authorizes with `write` (which only a covering installation grants a bot)
  and relies on `AppPermissionGuard` having checked `issues: write` before the
  resolver ran. Tests target the GraphQL mutation and Ghost's route, not the
  method signature. *(Claude's call.)*
- `DeleteIssuePayload` is added to `GRAPHQL_TYPE_PERMISSIONS` as `metadata`,
  like the other mutation payloads.
- A refusal in GraphQL reads as GitHub's FORBIDDEN wording, through
  `IssueMutationsService.write`.

### What may be deleted

- Issues only. `deleteIssue` with a pull request's node id, and Ghost's own
  delete route with a pull request's number, are refused. Ghost's own route
  answers 404 for a pull request number, since the route is about issues; the
  GraphQL mutation fails the way GitHub fails for an id that does not resolve
  to an `Issue`.
- Writes are refused while the repository is importing (`assertNotImporting`),
  as every other issue write is.

### What deletion removes

One database transaction:

1. Lock the issue row, check it is still an issue, and read what the event
   needs.
2. Delete the `issue` row. Comments, labels, assignees, its own timeline
   events, references to and from it, notifications and subscriptions
   cascade.
3. Publish `issue.deleted` in the same transaction (ADR 0029).

Notes:

- No object storage is involved, so ADR 0020's tombstone-then-purge does not
  apply. One transaction is the whole delete.
- Attachments embedded in the issue or its comments are not deleted in the
  transaction. They have no link to the text that embeds them, and the
  existing sweeper removes attachments no text mentions. That delay is
  accepted.
- "Mentioned in" entries in other issues' timelines come from
  `issue_reference`, whose `source_issue_id` and `target_issue_id` both
  cascade, so they go with the row. `issue_event.source_issue_id` (set null)
  is only ever a pull request's id on a `closed` event, and pull requests are
  never deleted, so it needs no change. One test proves another issue's
  timeline loses the mention.
- Events already in the outbox for the issue (for example `issue.commented`
  just before the delete) are skipped by their consumers, because their rows
  are gone. This is existing behaviour (`lib/events/events.ts`).

### Numbers are never reused

Today a new issue takes `max(number) + 1` in its repository
(`resources/issues/issues.service.ts`). Deleting the newest issue would hand
its number out again.

Add a per-repository counter of the last number given out. A new issue or pull
request takes `counter + 1` and advances it in the same transaction. The
migration backfills the counter with each repository's current
`max(number)`. The GitHub importer keeps GitHub's numbers, so it must raise the
counter to at least the highest number it writes.

The builder picks where the counter lives (a column on `repository` is the
obvious place) and how concurrent opens serialise on it (for example
`update ... set counter = counter + 1 returning`, which row-locks the
repository). The existing retry on the unique index may stay or go.

Migrations are generated with `bun db:generate`, never hand-edited.

### Event and webhooks

- `EventPayloads['issue.deleted']` carries the issue as it was, since there is
  no row left to read, as `issue.comment_deleted`, `label.deleted` and
  `release.deleted` do:
  `{ issue: { id, number, title, body, state, authorId } }`.
- `WEBHOOK_EVENTS` in `packages/webhooks` gets
  `"issue.deleted": { label: "An issue is deleted", permission: "issues" }`.
- `webhookEventOf` needs no mapping. Pull requests are never deleted.
- `WebhookFanoutService` builds the `issue` object of the body from the
  payload, not from `threadOf`, with the same fields and `htmlUrl` as other
  issue events. The sender is the actor.
- The chat formats in `lib/webhooks/formats/` (Slack, Discord, Teams, Google
  Chat) get a message for `issue.deleted`.
- The notifier ignores `issue.deleted`.
- `docs/webhooks.md` lists the event.

### Ghost's own API

`DELETE /api/repositories/:username/:repo/issues/:number` on the issues
controller, session auth, answering like the other issue deletes in that
controller (`deleteComment` answers `{ deleted: true }`). A missing issue,
a pull request number, or an issue the requester cannot read answers 404. A
reader who can see the issue but is not an admin gets 403.

### GraphQL

`deleteIssue` in `github/graphql/resolvers/issue-mutations/`, beside
`closeIssue`, calling the same service method as Ghost's own route. It needs a
write scope (`requireWriteScope`) for OAuth tokens, like the other mutations.
`repository` in the payload is the issue's repository. Schema conformance
(`schema-conformance.spec.ts`) must pass against GitHub's schema.

### Web UI

On the issue page, admins see "Delete issue" (GitHub puts it at the bottom of
the sidebar). It opens a confirmation dialog. On success the browser goes to
the repository's issue list. Non-admins and pull request pages do not show it.
Claude builds this after the backend is green.

## Acceptance criteria

- An admin deletes an issue. It is gone from lists, search, GraphQL and its
  URL (404). The next issue opened gets a new number, even when the deleted
  issue was the newest.
- Its comments, labels, assignees, events, references and notifications are
  gone. Other issues' timelines no longer show it.
- A non-admin collaborator, an anonymous user, and an installation token
  without `issues: write` are refused. An installation token with
  `issues: write` succeeds.
- A pull request cannot be deleted through either route.
- Webhook endpoints and app installations subscribed to `issue.deleted`
  receive it with the issue's last state. Endpoints not subscribed, and
  installations without `issues` read, do not.
- Importing a repository still keeps GitHub's numbers, and a later new issue
  numbers after the highest imported one.

## Workflow

Claude writes failing tests first. Gurpal makes them pass. Claude reviews the
result, then builds the web UI.

## Left to the builder

- Where the number counter lives and how opens serialise on it.
- Service and method names, error classes, and the chat message wording.
