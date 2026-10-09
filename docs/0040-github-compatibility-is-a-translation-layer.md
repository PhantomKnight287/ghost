# 0040 — GitHub compatibility is a translation layer on the API host

**Status:** adopted

## Decision

`apps/api/src/github/` serves GitHub's GraphQL API at `/api/graphql` and GitHub's REST v3 at `/api/v3`, on the API host. Users point the GitHub CLI at it with `GH_HOST=api.<domain>`. Every resolver and controller calls the existing Ghost services, so permissions, numbering, events and notifications stay where they are.

Pure helpers live in `apps/api/src/lib/github/`, and only `src/github/` imports them. `to<GitHubType>` mappers are allowed there and nowhere else. Each one is a last resort and carries a one-line comment saying why a query could not select GitHub's shape directly.

The GraphQL schema is code-first, generated to `apps/api/github.schema.gql` and committed. A test checks every type, field, argument and enum value in it against `@octokit/graphql-schema`, GitHub's published schema.

Node ids are `<GitHub prefix>_<base64url(Ghost id)>`: `U_`, `O_`, `R_`, `I_`, `PR_`, `IC_`, `LA_`.

`/api/v3/meta` reports GitHub Enterprise Server `3.17.0`. Introspection and GraphiQL are on in every environment. The REST routes appear in the OpenAPI document under the `GitHub compatibility` tag.

## Why

`gh` treats any host other than github.com as GitHub Enterprise Server and calls `https://HOST/api/v3/` and `https://HOST/api/graphql`. The API host already serves `/api` and the git transport, so `gh repo clone` and git credentials resolve against the same host.

Code-first types with a conformance test catch a misspelled field or a wrong nullability in CI, before `gh` hits it.

Version 3.17.0 keeps `gh` on the classic `search(type: ISSUE)` syntax, which Ghost can translate onto its own issue filters.

Rejected:

- Hand-written SDL: easy to get wrong, and it drifts from the resolvers.
- Loading GitHub's full schema at runtime: about 70,000 lines of fields nothing resolves.
- A separate service: the translation needs nearly every Ghost service.

## Consequences

- `databaseId` and the REST `id` are null. Ghost ids are text, and GitHub declares both nullable.
- Milestones, reactions and sub-issues answer empty. They exist only so `gh`'s fixed queries validate.
- Ghost features without a GitHub equivalent are not exposed.
- `apps/docs/content/docs/github-compatibility.mdx` lists every known difference.
- Plan 2 adds OAuth apps, the device flow and real scopes. Until then every token and session is granted every scope `gh` checks for.
