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
- [x] Merge (merge commit only)
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
4. [ ] **Tags and releases.** No tag UI/API, no release notes or assets.
5. [ ] **Branch management.** No create/delete branch from the UI, no branch
   protection.
6. [ ] **Pull request reviews.** No approve/request-changes, no inline line
   comments, no drafts.
7. [ ] **Merge strategies.** Only merge commit. No squash or rebase, no
   conflict detection UI.
8. [ ] **Notifications.** No inbox, no email on mention/assign/review, no
   watch/subscribe.

### Tier 2: platform
9. [ ] **Webhooks.** Push/PR/issue events, HMAC signing, delivery log,
   redelivery. Already advertised on the landing page.
10. [ ] **CI / Actions.** Runner, job logs, commit status checks. Start with a
    commit status API (`POST /statuses/:sha`) so external CI can report; a
    runner is a much larger project.
11. [ ] **2FA / passkeys.** `apps/web/src/lib/auth/two-factor-methods.ts`
    exists, but the API's Better Auth has no `twoFactor` plugin. No OAuth
    login (GitHub/Google).
12. [ ] **Push errors over sideband.** Failures render as JSON, so the git CLI
    shows an unhelpful error (see [0011](0011-deferred.md)).
13. [ ] **Anonymous push note.** [0011](0011-deferred.md) says
    `receive-pack` accepts anonymous pushes, but `GitBasicAuthMiddleware` now
    rejects read-only actors. Verify and update the doc.

### Organizations, later
- [ ] **Audit log.** Member added or removed, role changed, repository
      transferred, settings changed; filterable by actor and action.
- [ ] **Custom organization roles.** Better Auth's dynamic access control is
      on, but only the built-in roles grant repository access.
- [ ] **Blocking users** at organization level.
- [ ] **Organization webhooks and secrets**, with webhooks (#9) and CI (#10).
- [ ] **Security policy:** required two-factor for members (needs #11), SSO /
      SAML, verified domains.

### Tier 3: nice to have
14. [ ] Milestones, issue templates, reactions, lock conversation
15. [ ] Follow users, activity feed, explore/trending
16. [ ] Web file editor, file upload, blame, per-file history
17. [ ] Gists, wiki, projects/kanban
18. [ ] Repository mirroring, import from GitHub, archive download (zip/tar)
19. [ ] WAL checkpoints/compaction (push currently reads full log, O(history))
20. [ ] Rate limiting, audit log, admin panel

## Known stale content
- Landing page (`apps/web/src/app/page.tsx:147`) says SSH is missing. SSH is
  implemented.

## Suggested order
1 → 3 → 2 → 9 → 10 (status API first). Settings and collaborators unblock
team use; webhooks then let external CI plug in.
