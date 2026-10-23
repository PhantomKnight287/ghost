# Rulesets C and D (required status checks, required signatures) and SSH signing keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `required_status_checks` and `required_signatures` ruleset rules, enforced on direct pushes, on Ghost's own API writes and on pull request merges, plus SSH signing keys so SSH-signed commits verify.

**Architecture:** The pure evaluator reads two new optional fields on `RefFacts`: the judged commit's latest status per context, and the commits the write adds that do not verify. `RulesetVerdictsService.judge` fills those fields for any targeted ref whose caller left them out. It reads statuses from the base repository through `CommitStatusesService.combinedFor`, and verifies added commits through `CommitVerificationService` against the push quarantine `env`. A merge supplies its own facts, because what it judges (the pull request head, and the commits each method lands) is not the transition's `newOid`. SSH verification is a new `sshsig` branch inside `CommitVerificationService`.

**Tech Stack:** NestJS, Drizzle (Postgres), vitest (unit + e2e), `ssh2` (already installed) and `node:crypto` for `sshsig`, Next.js app router, openapi-fetch.

**Spec:** `docs/superpowers/specs/2026-10-23-rulesets-cd-design.md` (read it with this plan). Earlier parts: `2026-10-19-rulesets-a-design.md`, `2026-10-21-rulesets-b-design.md`, `2026-10-23-rule-insights-design.md`.

## Global Constraints

- **Copy GitHub.** Where the spec is silent, do what GitHub does. Items marked "verify" are checked in Task 9.
- **Workflow.** Claude writes the failing tests and the code that makes them pass, for every task (user decision, 2026-10-23), then opens the pull requests.
- **Branch** `feat/rulesets-cd`. A "Checkpoint" step means: run the task's tests and `bunx tsc --noEmit -p apps/api/tsconfig.json`, then commit the task.
- **Code standards.** Follow `docs/code-standards.md`. Pure code goes in `lib/`, and `services/` holds only `@Injectable()` classes. Match the surrounding code's comment density and idiom.
- **Migrations.** Run `bun db:generate` at the repository root. Never hand-edit drizzle SQL. After any API DTO or route change, run `bun run openapi` at the root.
- **Database.** Run e2e only against throwaway containers, never the dev database at 192.168.1.4:
  - Postgres: `postgres:16-alpine` on port 55433.
  - RustFS: `rustfs/rustfs` on port 59000.
  - Command, from `apps/api`, on Node 22: `TEST_DATABASE_URL=postgres://postgres:test@localhost:55433/postgres TEST_S3_ENDPOINT=http://localhost:59000 npx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism <files>`.
  - Unit tests: `npx vitest run <file>` from `apps/api`.
- **`integration_id` is refused**, with the message `integration_id needs Ghost Apps, which this server does not have yet`: 400 on Ghost's API, 422 on GitHub REST.
- **No signing key.** Saving a ruleset that contains `required_signatures` while `COMMIT_SIGNING_KEY` is unset is refused with `Required signatures need a commit signing key on this server`: 400 on Ghost's API, 422 on GitHub REST. The UI shows no warning in advance.
- **Statuses come from the base repository only**, never from a fork.
- **Cost.** With no active or evaluate C/D rule targeting a ref, `judge` runs no extra git command and no extra query.
- **Tests identify messages by `requirement`, not text**, except the two messages above. Take the other wording from GitHub in Task 9.

## Review Focus

1. **An annotated tag pushed to a tag ruleset with C.** Statuses live on commits, so the judged sha must be the peeled commit, not the tag object. Unit test in Task 3 and e2e test in Task 4.
2. **A push that creates two branches at the same new commits under D.** Each commit is verified once, and both refs are judged. Integration test in Task 4.
3. **A status posted on the fork's head sha but not on the base.** The base's required check stays unmet. e2e test in Task 5.
4. **A context reported `success` and then `failure` later.** The latest status wins and the check is unmet. Unit test in Task 3.
5. **A merge-requirements page load with C/D rules.** It must create no rule suite, like the other rules. Covered by the existing `rule-insights.e2e-spec.ts` case, which is extended in Task 5 with a C rule.

---

### Task 1: Data

**Files:**
- Modify: `packages/db/src/schema/rulesets.ts` (`rulesetRuleType`)
- Modify: `packages/db/src/schema/auth.ts` (new table beside `userSshKey`)
- Test: none beyond the generated migration and type check

**Interfaces:**
- Produces:
  - Enum values `required_status_checks` and `required_signatures`, appended to `rulesetRuleType`.
  - `userSshSigningKey` (`user_ssh_signing_key`) with columns `id` text pk (`sshsig_${createId()}`), `userId` (cascade), `title`, `fingerprint` (unique within this table), `publicKey`, `createdAt`. Index on `userId`. Copy `userSshKey`'s column comments for `fingerprint` and `publicKey`.

- [ ] **Step 1:** Add the enum values and the table, then run `bun db:generate` at the root. Expect one migration with two `ALTER TYPE ... ADD VALUE` statements and one `CREATE TABLE`.
- [ ] **Step 2:** Checkpoint.

### Task 2: SSH signing keys and `sshsig` verification (#60)

**Files:**
- Create: `apps/api/src/lib/ssh/sshsig.ts`
- Modify: `apps/api/src/lib/git/commits/commit-signature.ts` (stop skipping SSH signatures)
- Modify: `apps/api/src/services/gpg/commit-verification.service.ts`
- Create: `apps/api/src/resources/ssh-signing-keys/` with `nest g resource` (controller, service, module, `dto/ssh-signing-key.dto.ts`), mirroring `resources/ssh-keys`
- Modify: `apps/api/src/github/rest/users/users.controller.ts` and `users.service.ts`
- Modify: `apps/api/src/github/gh-capture.spec.ts` (remove `GET /api/v3/user/ssh_signing_keys` from `UNSERVED`)
- Test: `apps/api/src/lib/ssh/sshsig.spec.ts`, `apps/api/src/services/gpg/commit-verification.service.spec.ts`, `apps/api/test/ssh-signing-keys.e2e-spec.ts` (new), `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/ssh/sshsig.ts
  export type SshSignature = { publicKey: Buffer; namespace: string; hashAlgorithm: 'sha256' | 'sha512'; signature: Buffer };
  /** Parses an armored `-----BEGIN SSH SIGNATURE-----` block; null when it is not one. */
  export function readSshSignature(armored: string): SshSignature | null;
  /** Whether `signature` signs `payload` under namespace `git` with its own embedded key. */
  export function verifySshSignature(payload: string, signature: SshSignature): boolean;
  ```
- `SignedCommit` gains `format: 'openpgp' | 'ssh'`. `readSignedCommits` returns SSH-signed commits too.
- `CommitVerification.keyId` holds `SHA256:<fingerprint>` for SSH.
- Ghost API: `GET`/`POST /api/user/ssh-signing-keys` and `DELETE /api/user/ssh-signing-keys/:id`, with the same DTO shape and errors as `ssh-keys`.
- GitHub REST: `GET`/`POST /user/ssh_signing_keys` and `GET`/`DELETE /user/ssh_signing_keys/:id`, with GitHub's shape `{ id, key, title, created_at }`. Scopes follow GitHub: `read:ssh_signing_key`, `write:ssh_signing_key` and `admin:ssh_signing_key` (add them to `lib/github/scopes.ts` if they are missing).

- [ ] **Step 1: Write failing unit tests.**
  - Fixtures go in `lib/ssh/__fixtures__/`, generated once with `ssh-keygen -Y sign -n git` (ed25519 and RSA) and checked in.
  - `sshsig.spec.ts`:
    - `verifies an ed25519 signature`;
    - `verifies an RSA (rsa-sha2-512) signature`;
    - `refuses namespace "file"`;
    - `refuses a changed payload`;
    - `readSshSignature returns null for a PGP block`.
  - `commit-verification.service.spec.ts`, using SSH-signed commit fixtures:
    - `SSH signature by the author's signing key verifies` gives `{ verified: true, reason: 'Signed and verified' }`;
    - `SSH key on no account` gives `verified: false` with the unknown-key reason;
    - `SSH key on another user` gives `verified: false`;
    - `SSH key whose owner has not verified the author email` gives `verified: false`, with the not-linked reason;
    - `an authentication key alone does not verify`: the key is in `user_ssh_key` only.
- [ ] **Step 2:** Run them. Expect FAIL (module missing).
- [ ] **Step 3:** Write failing e2e tests in `test/ssh-signing-keys.e2e-spec.ts`:
  - add, list and delete through the Ghost API;
  - the same through GitHub REST;
  - the same fingerprint may be both an SSH key and a signing key;
  - a duplicate signing key gives 422 on REST;
  - a signing key grants no git access over SSH.

  In `gh-cli.e2e-spec.ts`: `gh ssh-key add --type signing` then `gh ssh-key list` shows it with type `signing`.
- [ ] **Step 4:** Implement. `sshsig` is built on `ssh2`'s `utils.parseKey` and `verify`, plus `node:crypto` hashing, over the signed blob `SSHSIG || string(namespace) || string(reserved) || string(hash_alg) || string(H(payload))`. Do not shell out to `ssh-keygen`. In `CommitVerificationService`, SSH keys are found by fingerprint, and the owner's verified emails take the place of GPG key emails. The platform key stays GPG only.
- [ ] **Step 5:** Run unit, e2e and gh tests. Expect PASS. Checkpoint.

### Task 3: The evaluator

**Files:**
- Modify: `apps/api/src/lib/rulesets/rulesets.types.ts`
- Modify: `apps/api/src/lib/rulesets/evaluate-rulesets.ts`
- Create: `apps/api/src/lib/rulesets/status-check-parameters.ts`
- Test: `apps/api/src/lib/rulesets/evaluate-rulesets.spec.ts`, `apps/api/src/lib/rulesets/status-check-parameters.spec.ts`

**Interfaces:**
- Produces, in `rulesets.types.ts`:
  ```ts
  export const StatusCheckRuleParametersZodSchema = z.strictObject({
    required_status_checks: z.array(z.strictObject({ context: z.string().min(1), integration_id: z.never().optional() })),
    strict_required_status_checks_policy: z.boolean().default(false),
    do_not_enforce_on_create: z.boolean().default(false),
  });
  export type StatusCheckRuleParameters = z.infer<typeof StatusCheckRuleParametersZodSchema>;
  export type RefFacts = {
    isFastForward: boolean;
    introducesMergeCommit: boolean;
    /** Latest state per context on the judged commit, base repository only. */
    statuses?: { context: string; state: CommitStatusState }[];
    /** Merges only: whether the head contains the base tip. */
    upToDate?: boolean;
    /** Commits the write adds that do not verify. */
    unverifiedCommits?: { sha: string; reason: string }[];
  };
  ```
  `REQUIREMENTS` gains `'status_checks'`, `'up_to_date'` and `'signatures'`.
- `parseStatusCheckParameters(input: unknown)` in `status-check-parameters.ts` has the same result shape as `parsePullRequestParameters`. A set `integration_id` gives `{ ok: false, message: 'integration_id needs Ghost Apps, which this server does not have yet' }`.
- `requiredContexts(rulesets: Ruleset[], ref: string, defaultBranch: string): string[]` is exported from `evaluate-rulesets.ts`. It returns the union of contexts from active rulesets targeting `ref`, sorted. It is used by `isRequired` and the merge box.

- [ ] **Step 1: Write failing tests** in `evaluate-rulesets.spec.ts`, `describe('required_status_checks')`:
  - `push of a tip with success on every context passes`;
  - `missing context fails with requirement status_checks`. `details` names the context and says it is expected;
  - `pending, failure and error each fail`;
  - `contexts union across rulesets`: ruleset X requires `build`, Y requires `test`, and only `build` succeeded, so it fails naming `test`;
  - `do_not_enforce_on_create skips a create only for its own rule`: two rulesets, one with the flag, and a create fails only on the other;
  - `deletion is not judged`;
  - `strict on a merge with upToDate false fails with up_to_date`. On a push, strict adds nothing;
  - `missing statuses facts fail closed`;
  - `bypass always moves it to bypassed`, and `evaluate never refuses`. Both mirror the existing pattern.

  In `describe('required_signatures')`:
  - `no unverified commits passes`;
  - `each unverified commit is listed in details` (requirement `signatures`);
  - `missing unverifiedCommits fails closed`;
  - `deletion is not judged`.

  `status-check-parameters.spec.ts`:
  - defaults filled in;
  - `integration_id` refused with the exact message;
  - an empty context refused;
  - an unknown key refused.

  `requiredContexts`:
  - union of active rulesets only;
  - evaluate and disabled rulesets excluded.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `broken` becomes per-rule. `required_status_checks` reads `facts.statuses` (absent counts as broken), and on a `pull_request_merge` with strict it also reads `facts.upToDate !== true`. `required_signatures` reads `facts.unverifiedCommits` (absent, or non-empty, is broken). Neither judges a deletion. A status-check rule with `do_not_enforce_on_create` does not judge a create. Messages, to be verified in Task 9: `Required status check "<context>" is expected.` or `... is <state>.`; `This branch is out-of-date with the base branch.`; `Commits must have verified signatures.` with one line per commit, `<short sha> <reason>`, listing at most 10, then `and N more`.
- [ ] **Step 4:** Run. Expect PASS. Checkpoint.

### Task 4: Push facts (git push and Ghost's API writes)

**Files:**
- Create: `apps/api/src/lib/git/refs/added-commits.ts`
- Modify: `apps/api/src/lib/git/protocol/verify-push.ts` (pass the quarantine `env` to the callback)
- Modify: `apps/api/src/services/rulesets/ruleset-verdicts.service.ts`
- Modify: `apps/api/src/git/git.service.ts` (`commitToLog`: pass `env` to `judge`)
- Modify: the module providing `RulesetVerdictsService`, to inject `CommitStatusesService` and `CommitVerificationService`
- Test: `apps/api/src/lib/git/refs/added-commits.spec.ts`, `apps/api/test/rulesets-enforcement.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 `RefFacts`, and Task 2 `CommitVerificationService.verifyCommits`.
- Produces:
  ```ts
  // lib/git/refs/added-commits.ts
  /** Commits `newOid` reaches that the write adds: beyond `oldOid` for an update, beyond every ref outside refs/pull/* for a create (as refFacts judges). */
  export function addedCommits(opts: { gitDir: string; env?: Record<string, string>; transition: RefTransition }): Promise<{ sha: string; authorEmail: string }[]>;
  /** `oid` peeled to the commit it names (annotated tags included). */
  export function peeledCommit(opts: { gitDir: string; env?: Record<string, string>; oid: string }): Promise<string>;
  ```
- `withVerifiedPack`'s callback gains `env: Record<string, string> | undefined`.
- `RulesetVerdictsService.judge` gains `env?: Record<string, string>`. For each transition that is not a deletion and is targeted by an applicable ruleset carrying the rule:
  - **C:** when its facts have no `statuses`, it sets them from `statuses.combinedFor([repository.id], [peeled])`, with one call for all refs.
  - **D:** when its facts have no `unverifiedCommits`, it sets them from the union of `addedCommits`, deduplicated by sha and verified in one `verifyCommits` call with `env`. Unsigned commits (absent from the result) get reason `Unsigned`.
  - Facts a caller already supplied are left alone.
- `commitToLog`'s `factsFor` keeps its two rules only. C and D need no quarantine-only facts apart from `env`, which `judge` now receives.

- [ ] **Step 1: Write failing tests.**
  - `added-commits.spec.ts`, on a temp repository:
    - update gives exactly the new commits;
    - create gives commits not reachable from other refs;
    - a create at existing history gives an empty list;
    - `peeledCommit` of an annotated tag gives its commit.
  - `rulesets-enforcement.e2e-spec.ts`, `describe('required_status_checks')`:
    - push of a fresh commit to `main` refused with GH013 naming `build`;
    - the same sha accepted after `POST statuses/:sha` with `success`, pushed first to a feature branch;
    - `pending` refused;
    - a bypass actor's push succeeds and prints the bypass notice;
    - a branch created through the API at a commit with `success` allowed, and at one without refused;
    - with `do_not_enforce_on_create`, a new targeted branch is created by `git push`;
    - an annotated tag on a tag ruleset is judged by its commit's statuses.
  - `rulesets-enforcement.e2e-spec.ts`, `describe('required_signatures')`:
    - unsigned push refused, listing the commit;
    - GPG-signed by the author's key accepted;
    - SSH-signed by the author's signing key accepted;
    - two new branches at the same signed commits both accepted, and an unsigned commit reached by both refs listed once per ref;
    - applying a suggestion on a head branch targeted by D, with `COMMIT_SIGNING_KEY` set in the test app, accepted;
    - the same suggestion on a head branch targeted by C refused.
  - Cost: `a repository with only an update rule runs no statuses query`. Spy on `CommitStatusesService.combinedFor` and `CommitVerificationService.verifyCommits`; neither is called.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the interfaces above. Add a `ponytail:` comment on the D path: `verification is linear in the commits a push adds; cache verdicts by sha and key set if first pushes of large histories show it`.
- [ ] **Step 4:** Run the new tests, then the whole `rulesets-enforcement`, `rulesets`, `pull-request-rules` and `rule-insights` e2e files. Expect PASS. Checkpoint.

### Task 5: Merge facts, merge blocking and the merge-requirements endpoint

**Files:**
- Modify: `apps/api/src/resources/pull-requests/pull-requests.service.ts` (`judgeMerge`, `mergeRequirements`, merge paths)
- Modify: `apps/api/src/resources/pull-requests/dto/pull-request.dto.ts` (merge requirements DTO)
- Test: `apps/api/test/pull-request-rules.e2e-spec.ts`, `apps/api/test/rule-insights.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 and Task 4.
- `judgeMerge` adds to the base ref's facts, only when an applicable ruleset carries the rule:
  - **C:** `statuses` from `combinedFor([base.id], [git.headSha])`, and `upToDate` from `merge-base --is-ancestor <baseSha> <headSha>` in the base directory.
  - **D:** `unverifiedCommits`:
    - method `merge`: unverified commits from `addedCommits` of `baseSha..headSha`;
    - every method: when `this.signing.signer` is undefined, also `{ sha: mergeCommitSha, reason: 'Ghost cannot sign the commits it writes on this server' }`.

    `squash` and `rebase` judge nothing else.
- The merge-requirements response gains `requiredContexts: string[]` from Task 3's `requiredContexts`, and `statuses` for the head (base repository only), so the merge box needs no second request.

- [ ] **Step 1: Write failing e2e tests** in `pull-request-rules.e2e-spec.ts`:
  - `describe('required_status_checks')`:
    - merge refused while `build` is missing, then pending, then failure;
    - allowed once `success`;
    - strict: refused with `up_to_date` after the base moves, and allowed after the head merges the base;
    - a fork pull request whose head has `success` posted on the fork only is refused;
    - `merge-requirements` lists `requiredContexts: ['build']` and the head's statuses.
  - `describe('required_signatures')`:
    - `merge` method with an unsigned pull request commit refused, listing it;
    - `squash` with the same commits allowed;
    - with all commits signed, `merge` allowed and the merge commit verifies as platform-signed.

  In `rule-insights.e2e-spec.ts`: loading `merge-requirements` with a C rule creates no rule suite.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Run `bun run openapi`.
- [ ] **Step 4:** Run. Expect PASS. Checkpoint.

### Task 6: Ruleset APIs accept C and D

**Files:**
- Modify: `apps/api/src/resources/rulesets/rulesets.service.ts` (`insertChildren`, plus a signing-key check before the transaction)
- Modify: `apps/api/src/resources/rulesets/dto/ruleset.dto.ts`, `apps/api/src/github/rest/rulesets/dto/rulesets.dto.ts` (enum and parameter docs)
- Modify: `apps/api/src/github/rest/rulesets/rulesets.service.ts` (map the errors to 422)
- Modify: GraphQL ruleset rule parameters (`RequiredStatusChecksParameters`, `StatusCheckConfiguration`) wherever `PullRequestParameters` is defined
- Create: a context suggestions endpoint `GET /api/repositories/:owner/:repo/status-contexts` in `resources/commit-statuses`
- Test: `apps/api/test/rulesets.e2e-spec.ts`, `apps/api/test/github-rulesets.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `RequiredSignaturesNeedKeyError` (400, with the Global Constraints message), thrown when the body has `required_signatures` and `CommitSigningService.signer` is undefined;
  - `InvalidRuleParametersError('required_status_checks', message)` for bad parameters;
  - `GET status-contexts` returns `{ contexts: string[] }`: the distinct contexts of this repository's statuses, newest first, at most 50. It needs write access, the same as editing rulesets.

- [ ] **Step 1: Write failing e2e tests.**
  - `rulesets.e2e-spec.ts`:
    - create with C round-trips with defaults filled in;
    - `integration_id` gives 400 with the exact message;
    - create with D while the test app has no signing key gives 400 with the exact message. Run it with the key unset; the test module controls `COMMIT_SIGNING_KEY`;
    - create with D while it has a key succeeds;
    - `status-contexts` gives contexts newest first, distinct and capped at 50.
  - `github-rulesets.e2e-spec.ts`:
    - REST round-trip of both rules;
    - 422 for `integration_id` and for D without a key;
    - `rules/branches/main` lists both;
    - GraphQL `repository.rulesets` returns `RequiredStatusChecksParameters`;
    - `evaluate` with C works.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Run `bun run openapi`.
- [ ] **Step 4:** Run. Expect PASS. Checkpoint.

### Task 7: gh compatibility

**Files:**
- Modify: `apps/api/src/github/graphql/resolvers/pull-request/pull-request-nodes.service.ts` (`mergeStateStatus`)
- Modify: `apps/api/src/github/graphql/resolvers/pull-request/pull-request.resolver.ts` (`StatusContextResolver.isRequired`; remove the "Ghost has no branch protection" comment)
- Modify: the REST pulls `mergeable_state` mapping (`apps/api/src/github/rest/pulls/pulls.service.ts`)
- Test: `apps/api/test/github-pull-request-rules.e2e-spec.ts`, `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- `mergeStateStatus` keeps `DRAFT` and `DIRTY` first. Then:
  - `BEHIND` when the only unmet requirement is `up_to_date`;
  - `BLOCKED` for any other violation or bypassed violation;
  - `UNSTABLE` when nothing is unmet and some status on the head is `failure` or `error`;
  - `CLEAN` otherwise.

  REST maps the same way (`behind`, `blocked`, `unstable`, `clean`). Precedence is verified in Task 9.
- `isRequired(pullRequestNumber | pullRequestId)` is true when the context is in `requiredContexts` for that pull request's base ref, through the existing per-request loaders. `CheckRunResolver.isRequired` stays false.

- [ ] **Step 1: Write failing tests.**
  - `github-pull-request-rules.e2e-spec.ts`:
    - `mergeStateStatus` is `BLOCKED` while `build` is missing;
    - `BEHIND` under strict when only behind;
    - `UNSTABLE` with a failing non-required status;
    - `CLEAN` once met;
    - `isRequired(pullRequestNumber:)` is true for `build` and false for `lint`;
    - REST `mergeable_state` agrees in each case.
  - `gh-cli.e2e-spec.ts`:
    - `gh pr checks --required` lists only `build`;
    - `gh pr merge` refuses on `BLOCKED`.

    Recapture fixtures as the earlier parts did.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expect PASS. Checkpoint.

### Task 8: Web and docs

**Files:**
- Modify: `apps/web/src/components/rulesets/ruleset-form.tsx`
- Modify: `apps/web/src/app/[username]/[repo]/pull/[number]/merge-panel.tsx` (and its children as needed)
- Modify: `apps/web/src/app/settings/keys/page.tsx` (signing keys section)
- Modify: the rule insights rendering, only if C/D evaluation details do not already display
- Create: `apps/docs/content/docs/signing/adding-an-ssh-signing-key.mdx` and `apps/docs/content/docs/signing/telling-git-about-your-ssh-key.mdx`; update `meta.json`, `index.mdx` and `signing-commits-and-tags.mdx`
- Modify: the rulesets docs page, adding both rules

- [ ] **Step 1: Ruleset form.**
  - "Require status checks to pass" has two checkboxes, "Require branches to be up to date before merging" and "Do not require status checks on creation".
  - It has a context list. Free text is added with Enter. Suggestions come from `status-contexts` in a combobox, and contexts already chosen are hidden. There is no source picker.
  - "Require signed commits" is one checkbox with no warning. A 400 from the save shows in the form's existing error slot.
- [ ] **Step 2: Merge box.**
  - A checks section lists each required context with a state icon and a "Required" badge, then non-required statuses.
  - "This branch is out-of-date with the base branch" shows when `up_to_date` is unmet.
  - The unverified commits list shows when `signatures` is unmet.
  - The bypass checkbox works as in part B.
- [ ] **Step 3: Settings › Keys.** A "Signing keys" section with the same add and delete as SSH keys, and copy explaining that a key can be in both lists.
- [ ] **Step 4: Docs** pages as listed, in the existing GPG pages' voice.
- [ ] **Step 5:** Run `bun run build` for `apps/web` and `apps/docs`, then check the flows by hand in the running app against a throwaway database. Checkpoint.

### Task 9: Verify against GitHub and close out

- [ ] **Step 1:** On a scratch GitHub repository, collect the spec's "Still to verify" list:
  - message wording;
  - whether an empty context list is accepted;
  - strict on pushes;
  - each merge method under required signatures, rebase especially;
  - `mergeStateStatus` precedence;
  - author or committer email;
  - a suggestion under required checks;
  - which rules tag rulesets accept.

  Update the code and the spec's "Checked against GitHub" section. If GitHub refuses rebase under required signatures, `allowedMergeMethods` drops `rebase` when a D rule applies, with a unit test in Task 3's spec.
- [ ] **Step 2:** Run the full API suite against throwaway Postgres and RustFS. Expect only the known storage-limits failure.
- [ ] **Step 3:** Check the cost anti-goal by hand: push to and merge in a repository with only part A rules, and confirm no statuses query or `cat-file` runs (query log, or a temporary log line).
