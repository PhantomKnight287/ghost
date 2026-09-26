# 0022 — Users and organizations share one namespace

**Status:** adopted

## Decision

The `owner` in `/owner/repo`, in git remotes, and in `owner/repo#1` references
is an organization's slug for an organization's repository, and otherwise the
owning user's username. Every query that names a repository computes it as
`coalesce(organization.slug, user.username)` (`ownerNameOf`), and every lookup
by name matches the same expression.

Because one name has to mean one owner, a username and an organization slug
can never be equal, ignoring case, and neither can be a top-level route of the
web app (`api`, `auth`, `dashboard`, `search`, `settings`). Better Auth's
availability checks (`is-username-available`, `organization/check-slug`) answer
across both namespaces, so a form reports a clash while it is typed.

An organization's settings live at `/<slug>/settings` (a user's at
`/settings`), so `settings` is reserved as a repository slug. An organization's
profile is public and lists only public repositories to outsiders; who belongs
to it is visible to its members alone, and a user's organizations are listed to
others only where they share one. Better Auth hooks refuse a sign-up or
username change that takes an organization's slug, and an organization create
or rename that takes a username.

An organization's repository keeps `ownerId` as the user who created it, but
that user gets nothing from it: access comes from the organization, as
[0023](0023-organization-access-is-a-base-permission.md) describes. Creating a repository in an
organization takes `admin` there, as `repository.create` in
`lib/permissions.ts` says. Slugs are unique per namespace: the organization, or
the user's own repositories.

Forking can target an organization the forker administers, one fork per
namespace. A repository's owner (the user, or an owner of its organization) can
transfer it to their own account or to an organization they administer; a
transfer to another user waits for an acceptance flow, since nobody should be
handed a repository they did not ask for.

## Why

GitHub's URLs are the model users bring, and a single namespace keeps every
existing route, git remote and reference parser working unchanged. The
alternative, a prefix such as `/orgs/acme/repo`, would split every route and
every stored reference in two.

## Consequences

- Custom organization roles (dynamic access control) grant no repository
  access; only the built-in ladder ranks.
- A user's contribution graph counts their commits in every repository the
  viewer can read, wherever it lives.
- A transfer or rename breaks the old URL; there are no redirects yet.
