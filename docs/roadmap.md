# Roadmap

Feature parity checklist against GitHub. Snapshot taken 2026-09-26 from the
API routes, DB schema, web pages and auth plugins.

## Done

### Git hosting
- [x] Create repositories (public/private), fork
- [x] Push/clone over HTTP (Basic auth)
- [x] Push/clone over SSH, SSH key management
- [x] WAL-on-S3 storage with materialized local cache
- [x] GPG commit signature verification, Verified badges, GPG key management

### Code browsing
- [x] Tree, blob, raw files, README rendering
- [x] Branch list, commit history, single commit diff and patch
- [x] Languages, contributors, stargazers, forks
- [x] Code search (Zoekt, indexed on push), repository search

### Issues
- [x] Create, edit, close, reopen
- [x] Comments, labels, assignees, timeline
- [x] `#123` cross references between issues and pull requests

### Pull requests
- [x] Compare branches, create, view commits/files/patch
- [x] Merge: merge commit, squash, rebase
- [x] Closing issues from pull requests

### Users and accounts
- [x] Profile, contribution graph, avatar
- [x] Stars, dashboard
- [x] Multiple emails with verification, password reset, sessions, API keys
- [x] Organizations: create/invite/accept UI (Better Auth plugin only)

### Other
- [x] OG images, docs site, Grafana/metrics, themes

## Not done

### Tier 1: obvious gaps
1. [x] **Repository settings.** `PATCH`/`DELETE /repositories/:username/:slug`
   and a Settings tab: rename, description, visibility, default branch,
   delete. Delete purges the log, cache and search shards before it answers
   ([0020](0020-deletion-is-a-tombstone-then-a-purge.md)). Follow-up:
   redirects from old slugs after a rename.
2. [x] **Organization-owned repositories.** Org repos, member roles, shared
   namespace, org profile ([0022](0022-owners-share-one-namespace.md)).
   Teams, fork into an organization, transfer, org contributions. Base
   permission and member policies, outside collaborators, leaving, public
   membership, profile details and pins, team pages and maintainers,
   `@org/team` mentions, org defaults, guided deletion, transfers with
   acceptance and redirects, `org:` search, dashboard switcher
   ([0023](0023-organization-access-is-a-base-permission.md)).
3. [x] **Collaborators and permissions.** Invite + accept, roles
   read/triage/write/maintain/admin ([0021](0021-access-is-a-role-ladder.md)).
   Invitations lapse after 7 days; the dashboard lists owned and shared
   repositories.
4. [x] **Tags and releases.** Tag list, browsing code at a tag, releases
   with Markdown notes, drafts and prereleases, a computed latest release in
   the sidebar; creating a release creates its tag
   ([0024](0024-tags-live-in-git-releases-in-rows.md)). Release assets with a
   per-account storage quota, off unless configured
   ([0025](0025-storage-is-billed-to-the-owning-account.md)). Follow-up:
   deleting tags from the UI, source archives (#18), per-account quota
   overrides, upload progress.
5. [x] **Pull request reviews.** Comment, approve and request changes; line
   comments batched in a pending review or posted singly, checked against the
   diff's hunks; threaded replies; editing and deleting comments and summaries;
   dismissing a verdict; `#123` references from reviews; each reviewer's
   standing verdict beside the merge button; draft pull requests that cannot
   merge until marked ready, and back again; comments on a range of lines;
   suggested changes applied as a commit to the head branch
   ([0026](0026-a-review-is-pinned-to-the-head-it-read.md)). Follow-up:
   applying several suggestions in one commit.
6. [x] **Merge strategies.** Merge commit, squash and rebase, picked beside
   the merge button, with the squash message editable before it lands;
   conflicting paths listed on the request
   ([0027](0027-squash-and-rebase-carry-the-head-along.md)).
7. [x] **Branch management.** A branches page listing every branch, with
   creating a branch from any other and deleting any but the default one or
   one an open pull request uses
   ([0028](0028-branch-writes-are-ref-only-pushes.md)). Branch protection is
   deferred (see below).
8. [x] **Notifications.** An inbox with unread counts in the header; email
   on mentions, team mentions, assignment, comments, reviews and state
   changes; subscribing to threads and watching or ignoring repositories.
   Events go through an outbox that webhooks will consume too
   ([0029](0029-events-go-through-an-outbox.md)). Follow-up: mentions added
   by an edit, per-user email preferences.

### Tier 2: platform
9. [x] **Webhooks.** Push/PR/issue events, HMAC signing, delivery log,
   redelivery. Already advertised on the landing page. Consume the outbox
   ([0029](0029-events-go-through-an-outbox.md)); push events are not
   published yet. Sent by `apps/delivery`
   ([0031](0031-outbound-delivery-is-its-own-service.md)).
10. [ ] **CI / Actions.** Runner, job logs, commit status checks. Start with a
    commit status API (`POST /statuses/:sha`) so external CI can report; a
    runner is a much larger project.
11. [ ] **2FA / passkeys.** `apps/web/src/lib/auth/two-factor-methods.ts`
    exists, but the API's Better Auth has no `twoFactor` plugin. No OAuth
    login (GitHub/Google).
12. [ ] **Push errors over sideband.** Failures render as JSON, so the git CLI
    shows an unhelpful error (see [0011](0011-deferred.md)).
13. [x] **Anonymous push note.** [0011](0011-deferred.md) says
    `receive-pack` accepts anonymous pushes, but `GitBasicAuthMiddleware` now
    rejects read-only actors. Verify and update the doc.

### Organizations, later
- [ ] **Audit log.** Member added or removed, role changed, repository
      transferred, settings changed; filterable by actor and action.
- [ ] **Custom organization roles.** Better Auth's dynamic access control is
      on, but only the built-in roles grant repository access.
- [ ] **Blocking users** at organization level.
- [x] **Organization webhooks.** Organization secrets come with the CI runner (#87).
- [ ] **Security policy:** required two-factor for members (needs #11), SSO /
      SAML, verified domains.

### Branches, later
- [ ] **Branch protection.** Deferred from #7: required reviews (needs #5),
      required status checks (needs #10), no force push, no deletion.

### Tier 3: nice to have
14. [ ] Milestones, issue templates, reactions, lock conversation
15. [ ] Follow users, activity feed, explore/trending
16. [ ] Web file editor, file upload, blame, per-file history
17. [ ] Gists, wiki, projects/kanban
18. [ ] Repository mirroring, archive download (zip/tar). Import from GitHub
    is done: code, releases, issues and pull requests, run by `apps/importer`
    ([0032](0032-github-imports-run-outside-the-api.md)).
19. [ ] WAL checkpoints/compaction (push currently reads full log, O(history))
20. [ ] Rate limiting, audit log, admin panel

## Order

Every open issue, in the order to take it. The tiers above say what is missing; this says what comes next. Items in the same step can run side by side.

### 1. GitHub compatibility (#57)
Tools built for GitHub working against Ghost unchanged. Milestones 1 (auth, repositories, issues over GraphQL), 2 (REST v3 for issues, comments and labels, #112) and 3 (pull requests, #114) are done.

1. #109 Ghost Apps, then #106 OpenID Connect, then #107 dynamic client registration.
2. #129 REST v3 for pull request review comments and creating reviews (`pulls/:number/comments`, `pulls/comments/:id`, `POST pulls/:number/reviews`). Then the GitHub sync bot, `apps/sync`: mirrors a repository to GitHub so CodeRabbit and other GitHub-only review bots work on Ghost, and brings their reviews back (spec on `feat/github-sync`).

Alongside, small and independent: #116 search across repositories, #117 `updateRepository` and `gh repo edit`, #119 type `decodeNodeId`, #113 measure migration lock time.

### 2. Platform and security
5. #63 Two-factor authentication and passkeys (roadmap 11), and #121 verifying commits signed with SSH keys.
6. #61 Commit status API (roadmap 10). Fills `statusCheckRollup` and `gh pr checks` from #114.
7. #62 Branch protection rules. Needs #61 for required checks.
8. #120 Report push failures over sideband (roadmap 12).
9. #67 Rate limiting across the API and git transports.
10. #68 WAL checkpoints and compaction. Push reads the whole log, so cost grows with history.
11. #64 Site admin panel and sign-up controls, then #69 audit log.
12. #65 Sign in with OIDC providers, then #79 organization security policy (needs #63 and #65).

### 3. Issues and pull requests (tier 3, roadmap 14)
13. #82 Lock conversations (#111 is a duplicate with the GitHub compatibility part).
14. #72 Milestones.
15. #74 Reactions.
16. #73 Issue and pull request templates.
17. #81 Notify people mentioned by an edit, #80 per-user notification email preferences.
18. #89 Apply several suggestions in one commit.

Each of 13 to 15 also fills a field the compatibility layer answers empty today (`locked`, `milestone`, `reactions`).

### 4. Code browsing and editing (roadmap 16, 18)
19. #71 Blame and per-file history.
20. #70 Edit, create and upload files in the browser.
21. #66 Download source archives.
22. #88 Delete tags from the UI.
23. #56 Git submodules.

### 5. Organizations, later
24. #77 Custom organization roles.
25. #78 Block users at the organization level.

### 6. Larger projects
26. #87 CI runner and organization secrets. Builds on #61.
27. #75 Repository mirroring.
28. #83 Follow users and an activity feed, then #84 explore and trending.
29. #85 Gists, #76 wiki, #86 project boards.
