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

- `gh auth login --hostname H --with-token`, `gh auth login --hostname H --web` (device flow), `gh auth status`
- `gh api user`, `gh api graphql`
- `gh repo view`, `gh repo clone`, `gh repo create`
- `gh issue list` (including `--search`, `--label`, `--assignee`, `--state`, `--json`), `gh issue view` (including `--comments`), `gh issue create`, `gh issue comment`, `gh issue close`, `gh issue reopen`, `gh issue edit`

## Host and routing

`gh` treats any host other than github.com as GitHub Enterprise Server and calls `https://HOST/api/v3/…` and `https://HOST/api/graphql`. Users set `GH_HOST` to the API host (`api.DOMAIN`):

- Caddy already sends `api.DOMAIN` to the API, and the API's global `/api` prefix puts the new routes at `/api/v3` and `/api/graphql` with no proxy change.
- Clone URLs are already `https://api.DOMAIN/<owner>/<repo>.git`, so `gh repo clone` and `gh auth setup-git` resolve credentials for the same host.

`html_url` and other browser-facing URLs in responses point at the web origin; `url`, `clone_url` and API links point at the API origin. Both come from existing configuration.

## Layout

Everything lives in `apps/api/src/github/`, a sibling of `src/git/`, outside `resources/`. As with git (ADR 0003), this is a foreign protocol: it does not appear in Ghost's OpenAPI document and its controllers are `@ApiExcludeController()`.

```
apps/api/src/github/
  github.module.ts        GraphQLModule (Apollo), REST controllers, device-flow aliases
  auth/                   token guard, X-OAuth-Scopes interceptor, @Viewer() decorator
  device/                 /login/device/code and /login/oauth/access_token aliases
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

`src/github/lib/` holds `to<GitHubType>` mappers (`toIssueNode`, later `toIssueRest`). Mapping Ghost's shapes onto GitHub's is the purpose of this layer, so the ban on reshaping functions does not apply inside `src/github/`. It still applies everywhere else. If `scripts/check-standards.ts` enforces section 2, it gets a path exemption for `apps/api/src/github/`. GraphQL and REST mappers are separate, because the two GitHub shapes differ (camelCase nodes vs snake_case objects with URLs); the services under them are shared.

A new ADR, `docs/0040-github-compatibility-is-a-translation-layer.md`, records the layout, the mapper exception, `GH_HOST=api.DOMAIN`, and the device-flow token choice.

## Auth

### Tokens

`gh` sends `Authorization: token <x>` (and `Bearer <x>` in some paths). A guard in `src/github/auth/` accepts both prefixes and verifies the value as a Better Auth API key (`ghost_pat_…`). The resolved user is set on the request and on the GraphQL context. Anonymous requests are allowed; anything that needs a user answers as GitHub does (401 on REST, an error on GraphQL mutations).

Every response from the compat layer carries `X-OAuth-Scopes: repo, read:org, gist` and `X-GitHub-Media-Type: github.v3`, set by one interceptor. `gh auth login` and `gh auth status` read the scopes header and fail without it.

### Device flow

Better Auth 1.7.2 ships `deviceAuthorization` (`/api/auth/device/code`, `/device/token`, `/device`, `/device/approve`, `/device/deny`).

1. Register `deviceAuthorization({ validateClient })` in `lib/auth.ts`. `validateClient` accepts only `gh`'s built-in OAuth client ID (confirmed by the capture spike). Run the plugin's schema through the usual Drizzle migration.
2. `gh` posts to `https://HOST/login/device/code` and `https://HOST/login/oauth/access_token`, at the host root. Both paths join the global-prefix exclusion next to `GIT_TRANSPORT_ROUTES` and are registered before the git routes, which would otherwise read `login` as a username. `login` and `device` join `RESERVED_NAMES` in `lib/auth.ts`; the migration checks no existing user or organization holds either name.
3. `/login/device/code` calls `auth.api.deviceCode` and returns its result, with `verification_uri` set to `<web origin>/device`.
4. `/login/oauth/access_token` calls `auth.api.deviceToken`. On success it does not hand `gh` the session token: it creates a `ghost_pat_` API key for the user named "GitHub CLI (<date>)", revokes the device session, and returns `{ access_token, token_type: "bearer", scope }`. The CLI credential then shows in the user's API keys, where they can see and revoke it, and it does not expire with the session. Pending, slow-down, expired and denied states are returned in the status and body shape `gh`'s poller expects (GitHub answers pending with 200 and `error` in the body; the spike confirms what `gh` requires).
5. The web app gets a `/device` page: enter the user code, see the requested scopes, approve or deny. It uses the existing auth form components and requires a signed-in session.

## GraphQL

### Module

- `GraphQLModule.forRoot<ApolloDriverConfig>({ driver: ApolloDriver, path: '/graphql', useGlobalPrefix: true, autoSchemaFile: 'github.schema.gql', sortSchema: true, introspection: true, graphiql: true, context })`, served at `/api/graphql`.
- New dependencies: `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, `graphql`, `dataloader`. Dev: `@octokit/graphql-schema`.
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

Milestone 1 serves the REST routes `gh` calls for its commands, expected to be `GET /`, `GET /user`, `GET /users/:login`, `GET /repos/:owner/:repo`, `GET /repos/:owner/:repo/readme`, and `POST /user/repos` / `POST /orgs/:org/repos` if `repo create` uses them. The capture spike settles the list. Milestone 2 extends REST across the same domains (issues, comments, labels) from the same services.

- Response shapes follow GitHub's REST documentation, with snake_case fields and `url` / `html_url` links.
- Errors use GitHub's `{ message, documentation_url, errors? }` with the matching status. A dedicated exception filter on the compat controllers produces it; `DomainErrorFilter` and Ghost's own error format are unchanged.
- List routes send `Link: <…>; rel="next"` built from the keyset cursor.

## Capture spike (first implementation task)

Before types and routes are written, point real `gh` at a logging stub (`GH_HOST` to a local HTTPS server that records every request and answers from canned fixtures) and run every milestone-1 command. Record method, path, query string, headers, request body and the full GraphQL document for each. The log fixes:

- the exact GraphQL fields per type and the introspection queries `gh` sends
- the REST routes milestone 1 needs
- `gh`'s OAuth client ID and whether its device-flow poller accepts a non-200 pending response
- whether `GH_HOST` accepts `host:port`, which the e2e harness needs

The log is committed under `apps/api/test/fixtures/gh-capture/` and seeds the e2e test.

## Testing

1. **Schema conformance (unit).** Load `github.schema.gql` and `@octokit/graphql-schema`. For every type, interface, field, argument, enum value and scalar exposed, assert it exists in GitHub's schema with the same type and is not less nullable. A second assertion rebuilds the schema and fails if the committed file is stale.
2. **Library units.** Node-ID round trips and prefix rejection; cursor mapping; each mapper on a representative row; error mapping to type and wording.
3. **API e2e (`test/harness.ts`, throwaway Postgres and RustFS).** One spec per resolver and mutation: anonymous vs authenticated, private repository as `NOT_FOUND`. The token guard with `token` and `Bearer` prefixes and the scopes header. Device flow over HTTP: code, approve, token, the returned value is a `ghost_pat_` key, pending polls in `gh`'s expected shape, denied and expired codes. A user named `login` can no longer be created, and git routes keep working.
4. **Real `gh` e2e (`test/gh-cli.e2e-spec.ts`).** Skipped when `gh` is not on `PATH`. The harness serves the app over HTTPS with a self-signed certificate made in `global-setup.ts`; `SSL_CERT_FILE` makes `gh` trust it and `GIT_SSL_CAINFO` makes `git` trust it. Each run uses a temporary `GH_CONFIG_DIR` with `GH_HOST`, `GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `GH_BROWSER=true`. It runs every milestone-1 command, parses `--json` output and asserts on it. The device-flow case starts `gh auth login --web`, reads the user code from stderr, approves it over HTTP as the test user, and asserts `gh` exits 0 and `gh auth status` passes. Go on macOS ignores `SSL_CERT_FILE`, so this suite targets Linux (CI) first.

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
- GitHub App and OAuth app registration for third-party clients; only `gh`'s client ID is accepted
- Rate-limit headers and the `rateLimit` query
