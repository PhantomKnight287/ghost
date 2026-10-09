# GitHub API compatibility for the `gh` CLI

Issue: [#57](https://github.com/PhantomKnight287/ghost/issues/57)

## Goal

`GH_HOST=<ghost api host> gh …` works against a Ghost instance the way it does against GitHub Enterprise Server. Beyond `gh`, Ghost aims for as much compatibility with GitHub's GraphQL and REST APIs as it can reach, so tools built for GitHub work with less friction. This spec covers the foundation and the first milestone; later milestones add surface on the same foundation.

## Milestones

1. **This spec.** Auth (token paste and OAuth device flow), repositories, issues. GraphQL first.
2. REST v3 for the same domains, mapped from the same services.
3. Pull requests (`gh pr list/view/create/checkout/merge`).
4. Releases (`gh release`).

Each later milestone gets its own spec and plan.

## Commands in milestone 1

- `gh auth login --hostname H --with-token`, `gh auth login --hostname H --web` (device flow), `gh auth status`, `gh auth refresh`, `gh auth setup-git`
- `gh ssh-key list`, `gh ssh-key add`
- `gh api user`, `gh api graphql`
- `gh repo view`, `gh repo clone`, `gh repo create`
- `gh issue list` (including `--search`, `--label`, `--assignee`, `--state`, `--json`), `gh issue view` (including `--comments`), `gh issue create`, `gh issue comment`, `gh issue close`, `gh issue reopen`, `gh issue edit`

## Host and routing

`gh` treats any host other than github.com as GitHub Enterprise Server and calls `https://HOST/api/v3/…` and `https://HOST/api/graphql`. Users set `GH_HOST` to the API host (`api.DOMAIN`):

- Caddy already sends `api.DOMAIN` to the API, and the API's global `/api` prefix puts the new routes at `/api/v3` and `/api/graphql` with no proxy change.
- Clone URLs are already `https://api.DOMAIN/<owner>/<repo>.git`, so `gh repo clone` and `gh auth setup-git` resolve credentials for the same host.

`html_url` and other browser-facing URLs in responses point at the web origin; `url`, `clone_url` and API links point at the API origin. Both come from existing configuration.

## Layout

Everything lives in `apps/api/src/github/`, a sibling of `src/git/`, outside `resources/`: it speaks GitHub's protocol, not Ghost's. Its REST controllers do appear in Ghost's OpenAPI document, grouped under the `GitHub compatibility` tag so they read apart from Ghost's own routes. The web app's generated client does not need them; if the generator would pull them in, it filters that tag out. The GraphQL endpoint is documented by its own schema and GraphiQL.

```
apps/api/src/github/
  github.module.ts        GraphQLModule (Apollo), REST controllers, device-flow aliases
  auth/                   token guard, X-OAuth-Scopes interceptor, @Viewer() decorator
  oauth/                  /login/oauth/authorize, /login/device/code, /login/oauth/access_token
  rest/                   v3 controllers
  graphql/
    types/                @ObjectType / @InterfaceType / enum / scalar mirrors of GitHub's schema
    resolvers/            queries, mutations, field resolvers
    loaders/              per-request DataLoaders
  lib/                    to<GitHubType> mappers, node-ID codec, cursor mapping, error mapping
apps/api/github.schema.gql  generated schema, committed
```

Resolvers and controllers call the existing Ghost services for every read and write, so permission checks, numbering, events and notifications stay where they are. Nothing outside `src/github/` imports from it.

### Exception to code standard 2

Mappers are a last resort. They hide where a value came from and make a wrong field hard to trace, so the first choice is always a query that selects GitHub's field names directly, or a GraphQL field resolver that reads the one value it needs. A `to<GitHubType>` mapper in `src/github/lib/` (`toIssueNode`, later `toIssueRest`) is written only when a service's output cannot be used that way, and the ADR asks each one to say why in one line. Mapping Ghost's shapes onto GitHub's is the purpose of this layer, so the ban on reshaping functions is relaxed inside `src/github/` on those terms. It still applies everywhere else. If `scripts/check-standards.ts` enforces section 2, it gets a path exemption for `apps/api/src/github/`. GraphQL and REST mappers are separate, because the two GitHub shapes differ (camelCase nodes vs snake_case objects with URLs); the services under them are shared.

A new ADR, `docs/0040-github-compatibility-is-a-translation-layer.md`, records the layout, the mapper exception, `GH_HOST=api.DOMAIN`, OAuth apps issuing scoped `ghost_pat_` keys, and scoped keys being refused by Ghost's own API.

## Auth

The aim is to support every way `gh` authenticates. Anything that proves out of reach is listed as unsupported on the compatibility page (see [Compatibility documentation](#compatibility-documentation)), with the reason.

| `gh` auth path | How Ghost serves it |
| --- | --- |
| `gh auth login --with-token`, pasted token | PAT verified by the token guard |
| `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` | Same header, same guard |
| `gh auth login --web` | OAuth device flow, `gh` as a built-in OAuth app |
| `gh auth refresh --scopes …` | Device flow again with the wider scopes; the new token replaces the old one |
| `gh auth status` | `GET /api/v3/` with `X-OAuth-Scopes`, `viewer { login }` |
| `gh auth setup-git`, git credential helper | Git Basic auth with the token as password; the git middleware already verifies API keys and also enforces scopes |
| SSH key upload during `gh auth login`, `gh ssh-key add/list` | `GET`/`POST /api/v3/user/keys` over the existing SSH key service |
| `gh auth token`, `logout`, `switch` | Local to `gh`; nothing to serve |
| GitHub App installation tokens (`ghs_…`), fine-grained PAT permissions | Unsupported in milestone 1; listed on the compatibility page |

### Tokens

`gh` sends `Authorization: token <x>` (and `Bearer <x>` in some paths). A guard in `src/github/auth/` accepts both prefixes and verifies the value as a Better Auth API key (`ghost_pat_…`). The resolved user and the token's scopes are set on the request and on the GraphQL context. Anonymous requests are allowed; anything that needs a user answers as GitHub does (401 on REST, an error on GraphQL mutations).

Every response from the compat layer carries `X-OAuth-Scopes` with the token's scopes and `X-GitHub-Media-Type: github.v3`, set by one interceptor. `gh auth login` and `gh auth status` read the scopes header and fail without the scopes they need.

### Scopes

A key carries the GitHub scopes it was granted, stored in the API key's `permissions`. Milestone 1 recognizes `repo`, `public_repo`, `read:org`, `write:org`, `user`, `read:user`, `user:email`, `admin:public_key`, `delete_repo` and `gist` (accepted and granted, though gists do not exist).

- A PAT created in Ghost's UI holds every scope, as Ghost's keys do today. Choosing scopes when creating a PAT is later work.
- A key issued to an OAuth app holds only the scopes the user approved.
- The compat layer enforces scopes with one `@RequiresScope()` decorator on resolvers and REST routes, checked by the token guard. A missing scope answers as GitHub does (`FORBIDDEN` on GraphQL, 403 with `X-Accepted-OAuth-Scopes` on REST).
- The git middleware enforces scopes on a scoped key: reading a private repository needs `repo`, pushing needs `repo`, or `public_repo` for a public repository.
- Ghost's own REST API refuses keys issued to OAuth apps. Its controllers have no scope checks, and a third-party app must not reach past what the user approved.

### OAuth apps

Users can register their own OAuth apps, and `gh` is one of them. `@better-auth/oauth-provider` (new dependency) holds the app registry, the authorize and consent flow, authorization codes and PKCE.

- Users manage apps under settings: name, homepage, callback URL, client ID, client secret (shown once, can be regenerated), and an "Enable device flow" switch, as GitHub has.
- Users see the apps they authorized under settings and can revoke one, which revokes its keys.
- `gh` is seeded by migration as a built-in app owned by the instance, with `gh`'s client ID (confirmed by the capture spike), no secret, and device flow on. It cannot be edited or deleted by users.
- Authorization code flow at GitHub's paths, on the API host root: `GET /login/oauth/authorize` redirects to a consent page on the web app, `POST /login/oauth/access_token` exchanges the code. Responses follow GitHub's format: form-encoded by default, JSON when `Accept: application/json`.
- Access tokens are `ghost_pat_` API keys carrying the approved scopes. They do not expire, as GitHub OAuth app tokens do not, and they show in the user's authorized apps. The spike confirms the plugin lets the token endpoint issue our key; if it does not, the alias issues the key after the plugin validates the code.

### Device flow

Better Auth 1.7.2 ships `deviceAuthorization` (`/api/auth/device/code`, `/device/token`, `/device`, `/device/approve`, `/device/deny`).

1. Register `deviceAuthorization({ validateClient })` in `lib/auth.ts`. `validateClient` accepts a client ID that names a registered OAuth app with device flow on. Run the plugin's schema through the usual Drizzle migration.
2. `gh` posts to `https://HOST/login/device/code` and `https://HOST/login/oauth/access_token`, at the host root. The `/login/...` paths join the global-prefix exclusion next to `GIT_TRANSPORT_ROUTES` and are registered before the git routes, which would otherwise read `login` as a username. `login` and `device` join `RESERVED_NAMES` in `lib/auth.ts`; the migration checks no existing user or organization holds either name.
3. `/login/device/code` calls `auth.api.deviceCode` and returns its result, with `verification_uri` set to `<web origin>/device`.
4. `/login/oauth/access_token` dispatches on `grant_type`: the device-code grant calls `auth.api.deviceToken`, the authorization-code grant goes to the OAuth provider. On a device-flow success it does not hand out the session token: it creates a `ghost_pat_` API key for the app and the approved scopes, revokes the device session, and returns `{ access_token, token_type: "bearer", scope }`. Pending, slow-down, expired and denied states are returned in the status and body shape `gh`'s poller expects (GitHub answers pending with 200 and `error` in the body; the spike confirms what `gh` requires).
5. The web app gets a `/device` page: enter the user code, see the app and the requested scopes, approve or deny. It uses the existing auth form components and requires a signed-in session.

## GraphQL

### Module

- `GraphQLModule.forRoot<ApolloDriverConfig>({ driver: ApolloDriver, path: '/graphql', useGlobalPrefix: true, autoSchemaFile: 'github.schema.gql', sortSchema: true, introspection: true, graphiql: true, context })`, served at `/api/graphql`.
- New dependencies: `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, `graphql`, `dataloader`, `@better-auth/oauth-provider`. Dev: `@octokit/graphql-schema`.
- Introspection is on in every environment: `gh` sends feature-detection introspection queries to non-github.com hosts, and Apollo turns introspection off under `NODE_ENV=production` unless told otherwise. GraphiQL is on in every environment.
- `express.json()` is mounted for `/api/graphql` and `/api/v3` only. The global `bodyParser: false` stays, since git's raw streams depend on it (ADR 0003).
- `@thallesp/nestjs-better-auth` 2.7.0 lists `@nestjs/graphql ^13` as an optional peer. If it breaks with 14, patch or fork the package; the compat guard sets the viewer on the context itself regardless.

### Types

Code-first. Every type, interface, enum, scalar, field and argument uses GitHub's exact name, type and nullability. Milestone 1 includes:

- Scalars: `DateTime`, `URI`, `HTML`, `GitObjectID`
- Interfaces: `Node`, `Actor`, `RepositoryOwner`, `Comment`, `Closable`, `Labelable`, `Assignable`, `UniformResourceLocatable`
- Objects: `User`, `Organization`, `Repository`, `Ref`, `Issue`, `IssueComment`, `Label`, `PageInfo`, the connection and edge types for each list, and each mutation's payload
- Enums: `IssueState`, `IssueStateReason`, `RepositoryVisibility`, `IssueOrderField`, `OrderDirection`, `SearchType`

The capture spike fixes the exact fields each type needs for milestone 1. Fields beyond that are added as compatibility work continues; the conformance test guards every addition.

### Connections and pagination

One generic `Connection(Type)` factory builds `{ nodes, edges { node cursor }, pageInfo { hasNextPage hasPreviousPage startCursor endCursor }, totalCount }`. `first` and `after` map onto the services' existing `keyset()` cursors. `last` and `before` answer an `UNPROCESSABLE` error until a service supports paging backwards. `totalCount` reuses the services' count queries.

### Node IDs

`<prefix>_<base64url(uuid)>`, with GitHub's prefixes: `R_` repository, `I_` issue, `IC_` issue comment, `U_` user, `O_` organization, `LA_` label. The codec in `src/github/lib/node-id.ts` encodes, decodes, and rejects an ID whose prefix does not match the type a mutation expects. `node(id:)` and `nodes(ids:)` dispatch on the prefix.

### Queries

`viewer`, `repository(owner, name)`, `repositoryOwner(login)`, `user(login)`, `organization(login)`, `node(id)`, `nodes(ids)`, `search(type: ISSUE, query, first, after)`. `search` translates GitHub's issue query syntax (`repo:`, `is:open`, `is:closed`, `label:`, `assignee:`, `author:`, free text) onto Ghost's existing issue search and filters; unsupported qualifiers are ignored, as GitHub ignores unknown ones.

### Mutations

`createIssue`, `updateIssue`, `closeIssue`, `reopenIssue`, `addComment`, `addLabelsToLabelable`, `removeLabelsFromLabelable`, `addAssigneesToAssignable`, `removeAssigneesFromAssignable`. Each takes GitHub's `input: { …, clientMutationId }` and returns its payload `{ <node>, clientMutationId }`. A mutation with no viewer is refused.

### Errors

Apollo's `formatError` maps Ghost's domain errors to GitHub's shape, `{ type, path, locations, message }`, with `type` one of `NOT_FOUND`, `FORBIDDEN`, `UNPROCESSABLE`, and GitHub's wording, for example `Could not resolve to a Repository with the name 'owner/repo'.`. A private repository the viewer cannot read answers `NOT_FOUND`, as it does today and as GitHub does.

### N+1

Per-request DataLoaders in `graphql/loaders/` batch the relations a list asks for on every row: users by ID, labels by issue, assignees by issue, comment counts by issue. A loader is added when a field needs it, not ahead of time.

## REST v3

Milestone 1 serves the REST routes `gh` calls for its commands, expected to be `GET /`, `GET /user`, `GET /users/:login`, `GET /repos/:owner/:repo`, `GET /repos/:owner/:repo/readme`, `GET`/`POST /user/keys`, and `POST /user/repos` / `POST /orgs/:org/repos` if `repo create` uses them. The capture spike settles the list. Milestone 2 extends REST across the same domains (issues, comments, labels) from the same services.

- Response shapes follow GitHub's REST documentation, with snake_case fields and `url` / `html_url` links.
- Errors use GitHub's `{ message, documentation_url, errors? }` with the matching status. A dedicated exception filter on the compat controllers produces it; `DomainErrorFilter` and Ghost's own error format are unchanged.
- List routes send `Link: <…>; rel="next"` built from the keyset cursor.

## Capture spike (first implementation task)

Before types and routes are written, point real `gh` at a logging stub (`GH_HOST` to a local HTTPS server that records every request and answers from canned fixtures) and run every milestone-1 command. Record method, path, query string, headers, request body and the full GraphQL document for each. The log fixes:

- the exact GraphQL fields per type and the introspection queries `gh` sends
- every auth path in the table under [Auth](#auth), including `gh auth refresh` and `gh auth setup-git`
- whether `@better-auth/oauth-provider` lets the token endpoint issue a `ghost_pat_` key
- the REST routes milestone 1 needs
- `gh`'s OAuth client ID and whether its device-flow poller accepts a non-200 pending response
- whether `GH_HOST` accepts `host:port`, which the e2e harness needs

The log is committed under `apps/api/test/fixtures/gh-capture/` and seeds the e2e test.

## Testing

1. **Schema conformance (unit).** Load `github.schema.gql` and `@octokit/graphql-schema`. For every type, interface, field, argument, enum value and scalar exposed, assert it exists in GitHub's schema with the same type and is not less nullable. A second assertion rebuilds the schema and fails if the committed file is stale.
2. **Library units.** Node-ID round trips and prefix rejection; cursor mapping; each mapper on a representative row; error mapping to type and wording.
3. **API e2e (`test/harness.ts`, throwaway Postgres and RustFS).** One spec per resolver and mutation: anonymous vs authenticated, private repository as `NOT_FOUND`. The token guard with `token` and `Bearer` prefixes and the scopes header. Device flow over HTTP: code, approve, token, the returned value is a `ghost_pat_` key, pending polls in `gh`'s expected shape, denied and expired codes. OAuth apps: register, authorize with consent, exchange a code (form-encoded and JSON responses), PKCE, revoke an authorization and its keys. Scopes: a missing scope answers `FORBIDDEN` / 403 with `X-Accepted-OAuth-Scopes`; git refuses a push from a key without `repo`; Ghost's own API refuses a key issued to an OAuth app. A user named `login` or `device` can no longer be created, and git routes keep working.
4. **Real `gh` e2e (`test/gh-cli.e2e-spec.ts`).** Skipped when `gh` is not on `PATH`. The harness serves the app over HTTPS with a self-signed certificate made in `global-setup.ts`; `SSL_CERT_FILE` makes `gh` trust it and `GIT_SSL_CAINFO` makes `git` trust it. Each run uses a temporary `GH_CONFIG_DIR` with `GH_HOST`, `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `GH_BROWSER=true`. It runs every milestone-1 command and every auth path in the table, parses `--json` output and asserts on it. The device-flow case starts `gh auth login --web`, reads the user code from stderr, approves it over HTTP as the test user, and asserts `gh` exits 0 and `gh auth status` passes. Go on macOS ignores `SSL_CERT_FILE`, so this suite targets Linux (CI) first.

## Compatibility documentation

A docs-site page, `apps/docs/content/docs/github-compatibility.mdx`, lists what works: each `gh` command and auth path, each GraphQL type and REST route Ghost serves, and each known difference from GitHub. Anything unsupported is listed with the reason, so a user finds the gap there before they find it in a failing command. Every milestone updates the page in the same PR as the code, and the CI `gh` suite covers every command the page lists as supported.

## CI

A new workflow, `.github/workflows/api.yml`, runs on every pull request and every push to `main`:

- Postgres (`postgres:16-alpine`) and RustFS as service containers
- `gh` is preinstalled on `ubuntu-latest`
- `bun install`, `bun run check-types`, the API unit tests, then the API e2e suite with `--no-file-parallelism`, including the `gh` spec
- no root `.env` is present, so the `storage-limits` fork-quota test passes there

Prerequisite: `test/webhook-events.e2e-spec.ts` "publishes a release created as a draft, published, then deleted" fails on `main` (one extra `release.edited`). Fix it in its own PR before this workflow is required, so the workflow starts green.

## Out of scope for milestone 1

- Pull requests, releases, gists, Actions, checks, projects
- REST routes `gh` does not call (milestone 2)
- Paging backwards with `last` / `before`
- GitHub Apps and installation tokens; fine-grained PATs
- Choosing scopes when creating a PAT in the UI
- Rate-limit headers and the `rateLimit` query
