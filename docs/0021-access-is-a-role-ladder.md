# 0021 — Repository access is a role ladder, and an invitation grants nothing

**Status:** adopted

## Decision

Every repository permission check asks one question: is the actor's role at
least the operation's? Roles and operations share one ladder, lowest first:

```
read < triage < write < maintain < admin < owner
```

| Operation | Needed for |
|-----------|------------|
| `read`    | clone and fetch a private repository, open issues and comment |
| `triage`  | close, label and assign other people's issues and pull requests |
| `write`   | push, merge, edit anyone's issues and comments, manage labels |
| `maintain`| repository settings: name, description, default branch |
| `admin`   | visibility, collaborators, deleting the repository |

The owner is `repository.ownerId`, never a row. Everyone else holds a role
through `repository_collaborator`, and only once `acceptedAt` is set: a
pending row is an invitation, and grants nothing. Declining deletes the row;
so does removing a collaborator, and so does a collaborator leaving.

`RepositoryAccessService.authorize` resolves the role in the same query that
finds the repository and returns it as `viewerRole`, so callers that need a
second decision (visibility needs `admin` inside a `maintain` request) make it
without another query. Queries that filter many repositories at once join
`acceptedCollaboration(repositoryId, actor)` and decide with `canAccess`.

## Why

The ladder is the one `lib/permissions.ts` already describes for
organizations, so organization-owned repositories can reuse it. A single
ordering keeps the check one comparison, and every endpoint names the lowest
role that may use it rather than listing roles.

An invitation that must be accepted keeps a private repository from appearing
in someone's account, and their name from appearing on someone's repository,
without their consent.

## Consequences

- Public repositories stay readable to everyone; a role only matters above
  `read` or on private repositories.
- An unreadable repository still answers 404 at every rung, and a readable one
  answers 403 when the role is too low.
- An invitation lapses 7 days after it was sent, computed from `createdAt`, so
  nothing has to sweep it. A lapsed row stays, shown to admins as `expired`;
  inviting the same user again restarts its week and sends the email again.
