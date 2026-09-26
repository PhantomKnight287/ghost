# 0023 — Organization access is a base permission, raised per repository

**Status:** adopted; supersedes the organization half of
[0022](0022-owners-share-one-namespace.md)

## Decision

An organization role says what someone may do *to the organization*; it no
longer doubles as their role on its repositories.

| Organization role | On every repository | Runs the organization |
|-------------------|---------------------|-----------------------|
| `owner`           | `owner`             | everything, including deleting it |
| `admin`           | `admin`             | settings, people, teams, invitations |
| `member`          | the base permission | nothing |

The **base permission** (`organization_settings.basePermission`) is any
repository role, or none. On top of it, a member is raised by the roles their
teams hold on a repository (`repository_team`) and by their own collaborator
row; the highest wins ([0021](0021-access-is-a-role-ladder.md)). With the base
permission at none, a private repository is visible only to its teams and
collaborators, which is how a private repository is kept to one team.

The same `organization_settings` row holds the member policies (whether members
may create public or private repositories, whether private repositories may be
forked, the default branch recorded on new repositories) and the public profile
(description, website, location, email). It is written when the organization is
created.

## Around it

- **Outside collaborators:** people with collaborator rows on the organization's
  repositories who are not members, listed and removable from all of them at
  once.
- **Membership is private** unless a member publicizes it
  (`organization_public_member`); outsiders see public members only, and a
  user's public organizations.
- **Team maintainers** (`team_maintainer`) manage their team's members without
  administering the organization. Team membership is written by Ghost rather
  than through Better Auth, whose checks know only organization roles; the rows
  keep Better Auth's own dedupe key and `memberCount`.
- **Teams** live at `/<org>/teams/<team>`, named by a slug of their name, and
  are mentioned as `@org/team`.
- **Transfers** to the requester's own account or an organization they
  administer happen at once; any other recipient accepts first
  (`repository_transfer`). Renames and transfers leave a `repository_redirect`,
  which the access service follows when a name no longer matches a live
  repository, so links and git remotes survive.

## Why

GitHub separates the two for a reason: tying an organization role to repository
access meant every member could read every private repository, and nobody could
be admitted to one repository without being admitted to all of them.

## Consequences

- Migration `0026` maps every existing member role other than `owner` and
  `admin` to `member`, and gives every organization the default base permission,
  `read`.
- `settings` and `teams` are reserved repository slugs, since
  `/<owner>/settings` and `/<org>/teams` are pages of the owner's own.
- A redirect lands on the repository's root in the web app; the path below it
  is not carried over.
