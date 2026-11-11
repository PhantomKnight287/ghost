# Delete Issues Implementation Plan

> **For agentic workers:** this plan does not run through subagent-driven-development. Workflow (fixed by the user): Claude writes each task's failing tests and commits them red; Gurpal writes the code that greens them; Claude reviews (tests really green, no test edits, no special-casing, spec covered); Claude writes the web UI last (Task 6). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Repository admins, and app bots with `issues: write`, delete issues for good, through Ghost's own API, GraphQL `deleteIssue` and the web UI, with an `issue.deleted` webhook and numbers never reused.

**Architecture:** One service method in `IssuesService` deletes the row in one transaction and publishes `issue.deleted` through the outbox. Ghost's REST route and the GraphQL mutation both call it. A per-repository counter replaces `max(number) + 1`.

**Tech Stack:** NestJS, Drizzle/Postgres, vitest (unit `bun run test`, e2e `bun run test:e2e` in `apps/api`), TanStack (web).

**Spec:** `docs/superpowers/specs/2026-11-09-delete-issues-design.md`

## Global Constraints

- Follow `docs/code-standards.md`.
- Migrations come from `bun db:generate` at the repo root, never hand-edited.
- No REST delete in the GitHub compatibility layer.
- Pull requests are never deleted, by any route.
- E2e suites run only on a throwaway Postgres + rustfs + Redis (`TEST_DATABASE_URL`, `TEST_S3_ENDPOINT`, `TEST_REDIS_URL`), never the dev DB at 192.168.1.4.

## Review Focus

1. Deleting the newest issue, then opening one: the new issue must not get the old number. Task 2 tests it.
2. Two issues opened at the same time after the counter lands: distinct, consecutive numbers. Task 2 tests it.
3. A `ghu_` token: refused, since Ghost refuses `ghu_` on all of GraphQL. Task 3 guards it.
4. Deleting an issue twice (double click, retry): the second call answers 404, not 500. Task 1 tests it.
5. An installation token narrowed to another repository: refused even with `issues: write`. Task 3 tests it.

---

### Task 1: Ghost API delete route and cascade

**Files:**
- Test: `apps/api/test/delete-issues.e2e-spec.ts` (new; harness from `test/harness.ts`, setup like `test/webhook-events.e2e-spec.ts`)
- Modify: `apps/api/src/resources/issues/issues.controller.ts`, `apps/api/src/resources/issues/issues.service.ts`

**Interfaces:**
- Produces: `IssuesService.deleteIssue(params: IssueRef & { requesterId: string }): Promise<{ deleted: true }>`. `DELETE /api/repositories/:username/:repo/issues/:number` answers 200 `{ deleted: true }`.

- [ ] **Step 1: Write failing tests** in `describe('DELETE issue')`:
  - `an admin deletes an issue and it is gone`: 200 `{ deleted: true }`; then `GET …/issues/:number` is 404; the issue list and `GET …/issues?q=<title>` no longer contain it.
  - `everything hanging off the issue goes with it`: issue with a comment, a label, an assignee, a subscription and a notification for another user; after delete, zero `issue_comment`, `issue_label`, `issue_assignee`, `issue_event`, `notification`, `issue_subscription` rows for its id.
  - `another issue's timeline loses the mention`: issue B's body says `#A`; delete B; A's timeline has no entry from B.
  - `a write collaborator is refused with 403`, `an anonymous request is refused with 401`, `a reader of a private repository it cannot see gets 404`.
  - `a pull request number answers 404` and the pull request still exists.
  - `deleting twice answers 404 the second time`.
  - `refuses while the repository is importing` (same status other issue writes answer during an import; set the import row directly).
  - `an organization owner deletes in an organization repository`.
- [ ] **Step 2: Run** `bun run test:e2e -- delete-issues` in `apps/api`. Expected: FAIL (404 on the DELETE route).
- [ ] **Step 3: Commit red** `test(issues): failing tests for deleting an issue (#135)`.
- [ ] **Step 4 (Gurpal):** implement. `access.authorize` with `operation: 'admin'`; `assertNotImporting`; lock the row `for update`, refuse `isPullRequest` as `IssueNotFoundError`; delete; publish `issue.deleted` (Task 4's payload).
- [ ] **Step 5: Run** same command. Expected: PASS. Commit.

### Task 2: Numbers are never reused

**Files:**
- Test: `apps/api/test/delete-issues.e2e-spec.ts` (`numbers` block), `apps/api/src/services/imports/imports.integration.spec.ts`
- Modify: `packages/db/src/schema/repository.ts` (counter column, builder's choice of place), `apps/api/src/resources/issues/issues.service.ts` (open path), `apps/api/src/resources/pull-requests/…` (wherever a pull request takes a number), `apps/api/src/services/imports/import-writer.service.ts`, generated migration.

- [ ] **Step 1: Write failing tests:**
  - e2e `a deleted newest number is not reused`: open #1, #2; delete #2; open → `number === 3`.
  - e2e `a pull request after a deleted issue takes the next number`: delete newest issue, open a pull request → next number.
  - e2e `concurrent opens get distinct consecutive numbers`: 10 parallel `POST …/issues`; numbers are a permutation of `n+1 … n+10`.
  - integration `new issues number after the highest imported one`: import issues #5 and #9; open one on Ghost → `10`.
- [ ] **Step 2: Run** e2e and `bun run test -- imports.integration`. Expected: the reuse test FAILS with `2`; the import test may already pass (keep it as a guard).
- [ ] **Step 3: Commit red.**
- [ ] **Step 4 (Gurpal):** add the counter, backfill in the migration with each repository's `max(number)` (0 when none), take `counter + 1` atomically on every open, raise it in the import writer. `bun db:generate` at root.
- [ ] **Step 5: Run.** Expected: PASS. Commit.

### Task 3: GraphQL `deleteIssue`, tokens and bots

**Files:**
- Test: `apps/api/test/delete-issues.e2e-spec.ts` (`GraphQL deleteIssue` and `apps` blocks); existing `app-permissions.e2e-spec.ts` mapping test
- Modify: `apps/api/src/github/graphql/resolvers/issue-mutations/issue-mutations.resolver.ts`, `…/issue-mutations.service.ts`, `apps/api/src/github/graphql/types/mutations.type.ts`, `apps/api/src/lib/apps/graphql-permissions.ts`, `apps/api/src/resources/issues/issues.service.ts` (bot branch)

**Interfaces:**
- Consumes: `IssuesService.deleteIssue` (Task 1).
- Produces: `Mutation.deleteIssue(input: DeleteIssueInput { issueId: ID!, clientMutationId: String }): DeleteIssuePayload { clientMutationId, repository }`; `'Mutation.deleteIssue': { issues: 'write' }`; `DeleteIssuePayload: 'metadata'`.

- [ ] **Step 1: Write failing tests:**
  - `deletes an issue through deleteIssue as gh issue delete does`: admin token; payload `repository.nameWithOwner` is the repo; `clientMutationId` echoed; `issueOrPullRequest(number)` is then NOT_FOUND.
  - `refuses deleteIssue for a write collaborator with GitHub's FORBIDDEN wording`: error message `<login> does not have the correct permissions to execute \`DeleteIssue\``.
  - `refuses deleteIssue on a pull request id`; the pull request remains.
  - `refuses deleteIssue with a read-only OAuth scope`.
  - app-permissions: `an installation with issues write deletes an issue`; `an installation with issues read is refused`; `a token narrowed to another repository is refused`.
  - `refuses an admin's ghu_ token, as all of GraphQL refuses ghu_ tokens` (403).
  - The existing `every GraphQL type and root field is mapped or denied on purpose` and `schema-conformance.spec.ts` must pass with the new types.
- [ ] **Step 2: Run** the three e2e files. Expected: FAIL (`Cannot query field "deleteIssue"`).
- [ ] **Step 3: Commit red.**
- [ ] **Step 4 (Gurpal):** resolver beside `closeIssue`, through `IssueMutationsService.write('DeleteIssue', …)` and `requireWriteScope`. In `deleteIssue`, an app bot requester authorizes at `write`; everyone else at `admin`.
- [ ] **Step 5: Run.** Expected: PASS. Commit.

### Task 4: `issue.deleted` event and webhooks

**Files:**
- Test: `packages/webhooks/src/index.test.ts`, `apps/api/test/webhook-events.e2e-spec.ts`, `apps/api/src/resources/webhooks/webhooks.integration.spec.ts`, `apps/api/src/lib/webhooks/formats/formats.spec.ts`
- Modify: `packages/webhooks/src/index.ts`, `apps/api/src/lib/events/events.ts`, `apps/api/src/services/webhooks/webhook-fanout.service.ts`, `apps/api/src/lib/webhooks/formats/message.ts`, `docs/webhooks.md`

**Interfaces:**
- Produces: `EventPayloads['issue.deleted'] = { issue: { id: string; number: number; title: string; body: string | null; state: IssueState; authorId: string } }`; `WEBHOOK_EVENTS['issue.deleted'] = { label: 'An issue is deleted', permission: 'issues' }`.

- [ ] **Step 1: Write failing tests:**
  - webhooks package: `issue.deleted needs issues`.
  - delete-issues e2e: `publishes issue.deleted by the deleter, carrying the issue as it was`.
  - webhooks integration: `sends a deleted issue as it was, from what the event carried` (subscribed endpoint gets it from the payload; an unsubscribed one does not). Installation permission filtering is the existing generic `needs the event's permission at read`.
  - formats: `messageOf` row `ada deleted issue #7: Bell count`, linking the issue list (the issue page is gone).
  - notifier: `deleting an issue notifies nobody` (no new `notification` rows; put in Task 1's e2e file).
- [ ] **Step 2: Run** `bun run test` in `packages/webhooks` and `apps/api`, plus the e2e. Expected: FAIL.
- [ ] **Step 3: Commit red.**
- [ ] **Step 4 (Gurpal):** catalog entry, payload type, fanout case building `issue` from the payload (not `threadOf`), chat message, notifier skip, docs line.
- [ ] **Step 5: Run.** Expected: PASS. Commit.

### Task 5: Review

- [ ] Claude runs every suite above on a throwaway backend and confirms green.
- [ ] `git diff 7a8b67f -- '*.spec.ts' '*.test.ts' '*e2e-spec.ts'`: any change to a red test after its red commit is a finding unless the test was wrong.
- [ ] Check spec coverage line by line; report gaps; iterate until closed.

### Task 6: Web UI (Claude)

**Files:** issue page sidebar in `apps/web` (located at build time), plus the API client call.

- [ ] "Delete issue" at the bottom of the sidebar, shown only to admins and only on issues (not pull requests).
- [ ] Confirmation dialog; on success, go to the repository's issue list; on error, show it in the dialog.
- [ ] Check it on localhost:3000 through Claude in Chrome.
- [ ] Commit.
