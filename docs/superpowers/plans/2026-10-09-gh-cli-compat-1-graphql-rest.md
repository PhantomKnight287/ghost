# gh CLI compatibility, plan 1 of 2: GraphQL, REST and token auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GH_HOST=<api host> gh auth login --with-token`, `gh auth status`, `gh api`, `gh repo view/clone/create`, `gh issue list/view/create/comment/close/reopen/edit` and `gh ssh-key list/add` work against Ghost, proven by a CI suite that runs the real `gh` binary.

**Architecture:** A new `apps/api/src/github/` module serves GitHub's GraphQL API (code-first `@nestjs/graphql` on Apollo) at `/api/graphql` and GitHub's REST v3 at `/api/v3`, translating onto the existing Ghost services. One Express middleware turns `Authorization: token|Bearer <ghost_pat_…>` (or a session cookie, for GraphiQL) into a viewer and sets GitHub's scope headers. Pure helpers (node IDs, error types, search parsing, mappers, loaders) live in `apps/api/src/lib/github/`.

**Tech Stack:** NestJS 12, `@nestjs/graphql` 14 + `@nestjs/apollo` 14 + `@apollo/server` 5, `graphql` 16, `dataloader`, Drizzle, Better Auth API keys, vitest + supertest, `@octokit/graphql-schema` (dev), real `gh` 2.102 in CI.

**Spec:** `docs/superpowers/specs/2026-10-09-gh-cli-compat-design.md`

**Plan 2** (OAuth apps, device flow, scopes, `gh auth login --web`, `gh auth refresh`, `gh auth setup-git` scope checks) is written after this plan lands. It builds on the middleware and viewer from Task 4.

## Stack

The work ships as a GitHub stacked PR (`gh stack`, `--remote origin`), one layer per row, each green on its own. Task 1 is an unrelated fix with its own PR against `main`, merged first so CI starts green.

| # | Branch | Tasks |
| --- | --- | --- |
| 1 | `gh-compat/plans` | spec and this plan |
| 2 | `gh-compat/ci` | 2 |
| 3 | `gh-compat/graphql-plumbing` | 3 |
| 4 | `gh-compat/auth` | 4, 5 |
| 5 | `gh-compat/users` | 6, 7 (together: Task 6's conformance test fails on Task 3's placeholder until Task 7 removes it) |
| 6 | `gh-compat/repositories` | 8, 9 |
| 7 | `gh-compat/issues` | 10, 11 |
| 8 | `gh-compat/issue-mutations` | 12 |
| 9 | `gh-compat/repo-create-ssh` | 13, 14 |
| 10 | `gh-compat/docs` | 15, 16 |

Once layer 1 is reviewed it stays frozen: a correction to this plan rides in the layer that finds it, so the bottom layer never forces a restack of everything above. After a commit to a lower layer, run `gh stack rebase` then `gh stack push`. Task 17's PR step becomes `gh stack submit --remote origin` and merging the top layer.

## Facts established while planning (read before starting)

These come from reading `gh` v2.102.0 and `cli/oauth` v1.2.2 source and this repository. They correct or sharpen the spec:

- `gh`'s hostname validator rejects `:`; `GH_HOST` cannot carry a port. The `gh` e2e suite therefore serves HTTPS on port 443 for a hostname (`ghost.test`) mapped in `/etc/hosts`. It runs when `GH_E2E_HOST` is set (CI), and is skipped otherwise.
- For non-github.com hosts `gh` uses `https://HOST/api/v3/` and `https://HOST/api/graphql`.
- `gh auth status/login` call `GET /api/v3/` with `Authorization: token <t>` and read `X-Oauth-Scopes`. Missing `repo` or `read:org` fails the login; an **empty** header is accepted (treated as an integration token).
- `gh` calls `GET /api/v3/meta` and reads `installed_version` to pick a search syntax. Answering `3.17.0` keeps `gh` on the classic `search(type: ISSUE)` syntax and skips `SearchType` introspection.
- `gh` sends introspection queries (`__type(name: "Issue") { fields { name } }`, same for `Repository`) to enterprise hosts. Introspection must be on.
- `gh issue view` always asks for `milestone`, `reactionGroups`, `issueType`, `parent`, `subIssues`, `subIssuesSummary` and `comments(last: 1)`; Ghost has none of the first six, so they are answered as empty, GitHub-shaped values.
- `gh issue list --search` uses `search(type: ISSUE, last: $limit, after: …)`: `last` must be accepted on `search` and behaves like `first`.
- `gh` reads `repository(owner, name) { id databaseId name owner { login } sshUrl hasIssuesEnabled description hasWikiEnabled viewerPermission defaultBranchRef { name } parent { … } mergeCommitAllowed rebaseMergeAllowed squashMergeAllowed }` before most commands, and looks issues up with `repository { issueOrPullRequest(number:) }`.
- `gh repo create` uses the `createRepository` mutation, and REST `POST /user/repos` or `POST /orgs/:org/repos` only when a README, license or gitignore is requested.
- `@thallesp/nestjs-better-auth`'s `AuthModule` already installs JSON and urlencoded body parsers on every non-auth route, so no extra `express.json()` is needed for `/api/graphql` or `/api/v3`; git's `application/x-git-*` bodies are untouched. Its global guard handles GraphQL contexts; compat resolvers and controllers are marked `@AllowAnonymous()` and the compat middleware does authentication.
- `scripts/check-standards.ts` does not lint rule 2, so the mapper exception needs no script change. It does require every `*.errors.ts` file to live under `apps/api/src/lib/`.
- Pure functions belong under `src/lib/` (code standard 6), so the spec's `src/github/lib/` becomes `apps/api/src/lib/github/`. Only `src/github/` may import from `src/lib/github/`. Task 16 updates the spec's layout to match.
- Ghost ids are prefixed text (`repo_…`, `issue_…`, `ic_…`, `label_…`; users are Better Auth ids). There is no integer id, so `databaseId` answers `null` (GitHub declares it nullable).
- Anonymous access to a private repository throws `AuthenticationRequiredError` (401), a signed-in stranger gets `RepositoryNotFoundError` (404), and a reader attempting a write gets `RepositoryForbiddenError` (403).

## Global Constraints

- Node IDs: `<prefix>_<base64url(ghost id)>`; prefixes `U_` user, `O_` organization, `R_` repository, `I_` issue, `PR_` pull request, `IC_` issue comment, `LA_` label.
- GraphQL path `/api/graphql`; REST prefix `/api/v3`. Both behind the existing global `/api` prefix.
- Every compat response carries `X-OAuth-Scopes` and `X-GitHub-Media-Type: github.v3; format=json`. Plan 1 grants every key and session all of: `repo, read:org, write:org, user, read:user, user:email, admin:public_key, delete_repo, gist`.
- `/api/v3/meta` answers `installed_version: "3.17.0"`.
- Introspection and GraphiQL on in every environment; the old Playground stays off (Apollo 5 has none).
- Every GraphQL type, field, argument, enum value and scalar uses GitHub's exact name, type and nullability; the conformance test (Task 6) enforces it.
- `toX` mappers only in `apps/api/src/lib/github/`, each with a one-line comment saying why a query could not select GitHub's shape directly. No mapper anywhere else.
- Browser-facing URLs (`url`, `html_url`, `resourcePath` targets) use `WEB_APP_URL`; API links and clone URLs use `BETTER_AUTH_URL` (the API origin). `sshUrl` uses `SSH_CLONE_HOST` (empty string when unset).
- Code standards (`docs/code-standards.md`): one-line comments and strings, no string concatenation for layout, no `any`, error classes in `apps/api/src/lib/**.errors.ts`, `services/` holds only `@Injectable` classes.
- Commits: `api: …`, `ci: …`, `docs: …` style, lower case, **no Co-Authored-By or any Claude attribution line**.
- E2E runs only against throwaway containers, never the dev database at 192.168.1.4. Throughout this plan `$E2E` means, run from `apps/api`:
  ```bash
  TEST_DATABASE_URL=postgres://postgres:test@localhost:55433/postgres TEST_S3_ENDPOINT=http://localhost:59000 bunx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism
  ```
  with the containers started once:
  ```bash
  docker run -d --rm --name gh-compat-pg -e POSTGRES_PASSWORD=test -p 55433:5432 postgres:16-alpine
  docker run -d --rm --name gh-compat-s3 -e RUSTFS_ACCESS_KEY=ghost -e RUSTFS_SECRET_KEY=ghostsecret -e RUSTFS_VOLUMES=/data -e RUSTFS_ADDRESS=0.0.0.0:9000 -p 59000:9000 rustfs/rustfs:latest
  ```
- Unit tests: from `apps/api`, `bunx vitest run <path>`.

## Review Focus

1. **A private repository read anonymously or by a stranger** must answer `NOT_FOUND` with GitHub's "Could not resolve to a Repository with the name 'o/r'." and `repository: null`, never `FORBIDDEN` or a 401, or `gh` leaks existence and prints the wrong error. Pinned in Task 8.
2. **A wrong or revoked token** must answer 401 `{"message":"Bad credentials"}` on both `/api/v3` and `/api/graphql`, not fall through as anonymous, or `gh auth status` reports a logged-in-but-empty account. Pinned in Task 4.
3. **An issue number that belongs to a pull request** in `issueOrPullRequest` must come back as a `PullRequest`, so `gh issue view 5` on a PR prints GitHub's "is a pull request" message instead of crashing on missing fields. Pinned in Task 10.
4. **A node ID of the wrong type** passed to a mutation (a label id as `issueId`, or garbage) must answer `NOT_FOUND` "Could not resolve to a node with the global id of '…'", not a 500. Pinned in Tasks 5 and 12.
5. **`gh issue list --search` with qualifiers Ghost cannot filter on** (`milestone:`, `reason:`, `sort:`) must still list results with the qualifier ignored, not fail. Pinned in Task 11.

---

## File structure

```
apps/api/src/github/
  github.module.ts                    GraphQLModule (Apollo), REST controllers, resolvers, middleware wiring
  auth/
    github-request.ts                 GithubViewer and GithubRequest types
    github-auth.middleware.ts         token|Bearer|cookie -> viewer; scope + media-type headers; 401 on bad token
    viewer.decorator.ts               @Viewer() for resolvers and controllers
  graphql/
    scalars.ts                        URI, HTML, GitObjectID
    enums.ts                          every GitHub enum milestone 1 exposes, registered
    connection.ts                     PageInfo and Connection(Type, name) factory
    types/
      node.interface.ts               Node, Actor, RepositoryOwner, UniformResourceLocatable, Comment, Closable, Labelable, Assignable interfaces
      user.type.ts                    User
      organization.type.ts            Organization
      repository.type.ts              Repository, Ref, RepositoryConnection
      label.type.ts                   Label, LabelConnection
      issue.type.ts                   Issue, IssueConnection, IssueOrPullRequest union
      pull-request.type.ts            PullRequest (identity fields only, for the union)
      issue-comment.type.ts           IssueComment, IssueCommentConnection
      placeholders.type.ts            Milestone, ReactionGroup, ReactorConnection, IssueType, SubIssuesSummary, ProjectCardConnection, ProjectV2ItemConnection
      search.type.ts                  SearchResultItem union, SearchResultItemConnection
      mutations.type.ts               every milestone-1 input and payload
    resolvers/
      viewer.resolver.ts              Query.viewer/user/organization/repositoryOwner/node/nodes; User and Organization fields
      repository.resolver.ts          Query.repository; Repository fields
      issue.resolver.ts               Issue fields
      issue-comment.resolver.ts       IssueComment fields
      search.resolver.ts              Query.search
      issue-mutations.resolver.ts     createIssue, updateIssue, closeIssue, reopenIssue, addComment, label and assignee mutations
      repository-mutations.resolver.ts createRepository
  rest/
    github-rest.filter.ts             GitHub's REST error body for DomainError and HttpException
    meta.controller.ts                GET /v3, GET /v3/meta
    users.controller.ts               GET /v3/user, /v3/users/:login, /v3/user/keys, POST /v3/user/keys
    repos.controller.ts               GET /v3/repos/:owner/:repo, /readme; POST /v3/user/repos, /v3/orgs/:org/repos
apps/api/src/lib/github/
  node-id.ts (+ .spec.ts)             encodeNodeId, decodeNodeId
  github.errors.ts                    CouldNotResolveError, BadCredentialsError, GithubForbiddenError, UnprocessableError
  error-type.ts (+ .spec.ts)          graphqlErrorType(status)
  origins.ts                          githubOrigins(config)
  scopes.ts                           ALL_SCOPES
  permission.ts (+ .spec.ts)          repositoryPermissionOf(role)
  issue-search.ts (+ .spec.ts)        parseIssueSearch(query)
  nodes.ts (+ .spec.ts)               toUserNode, toOrganizationNode, toRepositoryNode, toLabelNode, toIssueNode, toPullRequestNode, toIssueCommentNode
  loaders.ts                          createLoaders(db)
  node-lookup.ts                      issueRefOf, labelNamesOf, usernamesOf (node id -> Ghost refs)
apps/api/src/github/graphql/schema-conformance.spec.ts
apps/api/github.schema.gql            generated, committed
apps/api/test/
  harness.ts                          (modify) startApp accepts httpsOptions
  global-setup.ts                     (modify) self-signed cert for GH_E2E_HOST
  gh.ts                               runGh(), ghEnv(), ghTls()
  github-graphql.e2e-spec.ts
  github-rest.e2e-spec.ts
  gh-cli.e2e-spec.ts
.github/workflows/api.yml
docs/0040-github-compatibility-is-a-translation-layer.md
apps/docs/content/docs/github-compatibility.mdx
```

---

### Task 1: Publish `release.edited` only when something changed (prerequisite, own PR)

`test/webhook-events.e2e-spec.ts` "publishes a release created as a draft, published, then deleted" sends `PATCH { isDraft: false }` twice and expects one `release.edited`. `ReleasesService.updateRelease` publishes `release.edited` on every PATCH, including the second, which changes nothing. GitHub sends `edited` only for a change. Fix the service, not the test.

**Branch:** `fix/release-edited-noop` from `main`, its own PR. Merge before Task 2's workflow is made required.

**Files:**
- Modify: `apps/api/src/resources/releases/releases.service.ts` (`updateRelease`, around lines 196–240)
- Test: `apps/api/test/webhook-events.e2e-spec.ts` (already failing; no change)

**Interfaces:** none new.

- [x] **Step 1: Run the failing test**

Run: `$E2E test/webhook-events.e2e-spec.ts -t "draft, published, then deleted"`
Expected: FAIL, the published list has a second `release.edited`.

- [x] **Step 2: Read the full row before the update and compare after**

In `updateRelease`, replace the `before` select and the publish block:

```ts
      const [before] = await tx
        .select({
          name: schema.release.name,
          body: schema.release.body,
          isDraft: schema.release.isDraft,
          isPrerelease: schema.release.isPrerelease,
        })
        .from(schema.release)
        .where(this.ownRelease(repository, id))
        .for('update');
      if (!before) throw new ReleaseNotFoundError();
```

```ts
      const [row] = await tx
        .update(schema.release)
        .set({ /* unchanged */ })
        .where(this.ownRelease(repository, id))
        .returning({
          id: schema.release.id,
          name: schema.release.name,
          body: schema.release.body,
          isDraft: schema.release.isDraft,
          isPrerelease: schema.release.isPrerelease,
        });
      if (!row) throw new ReleaseNotFoundError();
      const event = {
        repositoryId: repository.id,
        actorId: target.requesterId,
        payload: { releaseId: row.id },
      };
      // GitHub sends `edited` only for a change, so a repeated publish is silent.
      const changed =
        row.name !== before.name ||
        row.body !== before.body ||
        row.isDraft !== before.isDraft ||
        row.isPrerelease !== before.isPrerelease;
      if (changed) await publishEvent(tx, { type: 'release.edited', ...event });
      if (before.isDraft && !row.isDraft) {
        await publishEvent(tx, { type: 'release.published', ...event });
      }
      return row;
```

Keep the existing `.set({...})` body exactly as it is.

- [x] **Step 3: Run the test**

Run: `$E2E test/webhook-events.e2e-spec.ts`
Expected: PASS, all cases.

- [x] **Step 4: Commit and open the PR**

```bash
git add apps/api/src/resources/releases/releases.service.ts
git commit -m "api: publish release.edited only when the edit changed something"
```

---

### Task 2: API CI workflow on every PR and every push to main

**Branch:** `gh-compat/ci`, added with `gh stack add gh-compat/ci` on top of `gh-compat/plans`. Run `gh stack rebase` once Task 1 merges.

**Files:**
- Create: `.github/workflows/api.yml`

**Interfaces:** Produces the `GH_E2E_HOST=ghost.test` environment that Task 3's harness reads.

- [x] **Step 1: Write the workflow**

The workflow as shipped is `.github/workflows/api.yml` on `gh-compat/ci`; read it there. Two corrections from its first CI run, made in layer 2: the unit step runs `bunx vitest run --no-file-parallelism` (integration specs in the unit run each migrate the same database and race on it), and a second job, `delivery`, migrates its own Postgres with `bun packages/db/dist/migrate.js` and runs `go vet ./...` and `go test ./...` in `apps/delivery`.

`@ghost/db` is imported from `dist`, so turbo's `^build` dependency builds it before the type check; the unit and e2e steps reuse that build.

- [x] **Step 2: No compose change**

The api service loads `env_file: .env`, and `docker/setup.sh` already writes `SSH_CLONE_HOST` there, so `docker/compose.yaml` needs nothing. (Corrected in layer 2; the step originally added an `environment:` entry.)

- [ ] **Step 3: Push the branch and confirm the workflow runs**

```bash
git add .github/workflows/api.yml
git commit -m "ci: type-check and test the API on every pull request and push to main"
gh stack submit --remote origin
gh run list --workflow api.yml --branch gh-compat/ci --limit 1
```

Expected: a run starts. It may fail on the `webhook-events` case until Task 1 merges; every other suite passes. The schema step passes trivially (the file does not exist yet, so `git diff` is clean).

---

### Task 3: Dependencies, GitHub module skeleton, and the HTTPS `gh` harness

The outer loop of this plan is the real `gh` suite. This task makes `gh api graphql -f query='{ __typename }'` succeed end to end, so every later task adds one `gh` case first and then makes it pass.

**Files:**
- Modify: `apps/api/package.json` (dependencies)
- Create: `apps/api/src/github/github.module.ts`
- Create: `apps/api/src/lib/github/origins.ts`
- Modify: `apps/api/src/app.module.ts` (import `GithubModule` before `GitModule`)
- Modify: `apps/api/test/harness.ts`, `apps/api/test/global-setup.ts`
- Create: `apps/api/test/gh.ts`, `apps/api/test/gh-cli.e2e-spec.ts`, `apps/api/test/github-graphql.e2e-spec.ts`
- Create: `apps/api/github.schema.gql` (generated)

**Interfaces:**
- Produces `githubOrigins(config: ConfigService): { api: string; web: string; sshHost: string }`.
- Produces `startApp(env?, port?, httpsOptions?: { key: Buffer; cert: Buffer })` returning `{ app, origin }`, `origin` using `https://` when `httpsOptions` is set.
- Produces in `test/gh.ts`: `GH_E2E_HOST: string | undefined`, `tlsFiles(): { key: Buffer; cert: Buffer; certPath: string }`, `runGh(args: string[], options: { configDir: string; token?: string; input?: string }): Promise<{ stdout: string; stderr: string; code: number }>`.
- Produces `GithubModule` with `GraphQLModule.forRootAsync` and an empty resolver list that later tasks append to.

- [x] **Step 1: Add dependencies**

```bash
cd apps/api
bun add @nestjs/graphql@^14.0.3 @nestjs/apollo@^14.0.3 @apollo/server@^5 graphql@^16.11.0 dataloader@^2
bun add -d @octokit/graphql-schema@^15.26.1
```

If `bun install` warns that `@thallesp/nestjs-better-auth` wants `@nestjs/graphql ^13`, continue; the warning is the optional-peer range. Only if a later step fails inside that package, patch it with `bun patch @thallesp/nestjs-better-auth` and record the patch in the PR.

- [x] **Step 2: Write the failing GraphQL e2e test**

`apps/api/test/github-graphql.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub GraphQL', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghgql${Date.now()}`;

  const graphql = (query: string, variables: object = {}, token?: string) => {
    const call = request(app.getHttpServer()).post('/api/graphql').send({ query, variables });
    return token ? call.set('authorization', `token ${token}`) : call;
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers a query at /api/graphql', async () => {
    const response = await graphql('{ __typename }').expect(200);
    expect(response.body).toEqual({ data: { __typename: 'Query' } });
  });

  it('answers introspection, which gh sends to enterprise hosts', async () => {
    const response = await graphql('{ __type(name: "Query") { name } }').expect(200);
    expect(response.body.data.__type.name).toBe('Query');
  });
});
```

`owner` and `username` are used by later tasks that extend this file.

- [x] **Step 3: Run it to see it fail**

Run: `$E2E test/github-graphql.e2e-spec.ts`
Expected: FAIL, 404 on `/api/graphql`.

- [x] **Step 4: Write `origins.ts`**

`apps/api/src/lib/github/origins.ts`:

```ts
import type { ConfigService } from '@nestjs/config';

/** Where GitHub-shaped responses point: browser links at the web app, API links and clone URLs at the API, SSH clone URLs at the SSH host. */
export function githubOrigins(config: ConfigService) {
  return {
    api: config.getOrThrow<string>('BETTER_AUTH_URL').replace(/\/$/, ''),
    web: config.get<string>('WEB_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
    sshHost: config.get<string>('SSH_CLONE_HOST', ''),
  };
}

export type GithubOrigins = ReturnType<typeof githubOrigins>;
```

- [x] **Step 5: Write the module skeleton**

`apps/api/src/github/github.module.ts`:

```ts
import path from 'node:path';
import type { Database } from '@ghost/db';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import type { Request, Response } from 'express';

import { DATABASE, DatabaseModule } from '../database/database.module.js';
import { createLoaders } from '../lib/github/loaders.js';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [DatabaseModule],
      inject: [DATABASE],
      useFactory: (db: Database) => ({
        path: '/graphql',
        useGlobalPrefix: true,
        // Committed and diffed in CI, so a schema change shows in review; production builds it in memory.
        autoSchemaFile:
          process.env.NODE_ENV === 'production'
            ? true
            : path.join(import.meta.dirname, '../../github.schema.gql'),
        sortSchema: true,
        buildSchemaOptions: { dateScalarMode: 'isoDate', numberScalarMode: 'integer' },
        // gh sends introspection queries to every enterprise host; Apollo turns it off under NODE_ENV=production unless told.
        introspection: true,
        graphiql: true,
        playground: false,
        context: ({ req, res }: { req: Request; res: Response }) => ({
          req,
          res,
          loaders: createLoaders(db),
        }),
      }),
    }),
  ],
})
export class GithubModule {}
```

`createLoaders` comes from Task 7; until then create `apps/api/src/lib/github/loaders.ts` with:

```ts
import type { Database } from '@ghost/db';

/** Per-request batch loaders; one set per GraphQL request so nothing is cached across viewers. */
export function createLoaders(_db: Database) {
  return {};
}

export type Loaders = ReturnType<typeof createLoaders>;
```

Apollo refuses a schema with no query fields, so add a placeholder resolver that Task 7 deletes. `apps/api/src/github/graphql/resolvers/viewer.resolver.ts`:

```ts
import { Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@Resolver()
@AllowAnonymous()
export class ViewerResolver {
  @Query(() => String, { nullable: true, deprecationReason: 'Placeholder until Task 7.' })
  placeholder() {
    return null;
  }
}
```

Add `providers: [ViewerResolver]` to `GithubModule`. The conformance test (Task 6) would reject `placeholder`, which is why Task 7 removes it.

- [x] **Step 6: Register the module**

In `apps/api/src/app.module.ts`, import `GithubModule` from `./github/github.module.js` and add it to `imports` directly before `GitModule`. The `/login/...` aliases in plan 2 rely on the compat module registering before the git routes.

- [x] **Step 7: Run the GraphQL e2e test**

Run: `$E2E test/github-graphql.e2e-spec.ts`
Expected: PASS, both cases. `apps/api/github.schema.gql` now exists.

- [x] **Step 8: HTTPS support in the harness**

In `apps/api/test/harness.ts`, change `startApp`:

```ts
/** Serves the whole app on `port`, random unless given, against the database and bucket global-setup.ts prepared. `env` overrides the defaults below, such as turning the SSH transport on. `httpsOptions` serves it over TLS, which gh insists on for any host but github.com. */
export async function startApp(
  env: Record<string, string> = {},
  port = 0,
  httpsOptions?: { key: Buffer; cert: Buffer },
) {
```

and

```ts
  const app = moduleRef.createNestApplication({ bodyParser: false, httpsOptions });
  configureApp(app);
  await app.listen(port, '127.0.0.1');

  const scheme = httpsOptions ? 'https' : 'http';
  return {
    app,
    origin: `${scheme}://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
  };
```

In `apps/api/test/global-setup.ts`, after the bucket is created, add the certificate (the `gh` suite needs it; other suites ignore it):

```ts
  // gh trusts the certificate through SSL_CERT_FILE, git through GIT_SSL_CAINFO.
  const host = process.env.GH_E2E_HOST;
  if (host) {
    const dir = path.resolve(import.meta.dirname, '../.gh-e2e');
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`, '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
  }
```

Import `execFileSync` from `node:child_process` and `mkdirSync` from `node:fs`. Add `.gh-e2e/` to `apps/api/.gitignore` (create the file if missing).

- [x] **Step 9: `gh` helper**

`apps/api/test/gh.ts`:

```ts
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The hostname the gh suite serves on port 443; set in CI, where /etc/hosts maps it. The suite is skipped without it. */
export const GH_E2E_HOST = process.env.GH_E2E_HOST;

const certDir = path.resolve(import.meta.dirname, '../.gh-e2e');

export function tlsFiles() {
  const certPath = path.join(certDir, 'cert.pem');
  return {
    key: readFileSync(path.join(certDir, 'key.pem')),
    cert: readFileSync(certPath),
    certPath,
  };
}

/** Runs gh against the e2e host with its own config dir. Async because the server runs in this process. */
export function runGh(
  args: string[],
  { configDir, token, input }: { configDir: string; token?: string; input?: string },
) {
  const { certPath } = tlsFiles();
  const child = spawn('gh', args, {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: configDir,
      GH_CONFIG_DIR: configDir,
      GH_HOST: GH_E2E_HOST ?? '',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      NO_COLOR: '1',
      GH_BROWSER: 'true',
      SSL_CERT_FILE: certPath,
      GIT_SSL_CAINFO: certPath,
      ...(token && { GH_ENTERPRISE_TOKEN: token }),
    },
  });
  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) =>
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 })),
  );
}
```

- [ ] **Step 10: First `gh` case**

`apps/api/test/gh-cli.e2e-spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GH_E2E_HOST, runGh, tlsFiles } from './gh.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends || !GH_E2E_HOST)('gh CLI', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let configDir: string;
  const username = `ghcli${Date.now()}`;
  const gh = (args: string[], input?: string) =>
    runGh(args, { configDir, token: owner.key, input });
  const ok = async (args: string[], input?: string) => {
    const result = await gh(args, input);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    return result.stdout;
  };

  beforeAll(async () => {
    const { key, cert } = tlsFiles();
    ({ app } = await startApp(
      { BETTER_AUTH_URL: `https://${GH_E2E_HOST}`, WEB_APP_URL: `https://web.${GH_E2E_HOST}` },
      443,
      { key, cert },
    ));
    owner = await signUp(app, username);
    configDir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-'));
  });

  afterAll(async () => {
    await app?.close();
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  });

  it('reaches /api/graphql through gh api graphql', async () => {
    const out = await ok(['api', 'graphql', '-f', 'query={ __typename }']);
    expect(JSON.parse(out)).toEqual({ data: { __typename: 'Query' } });
  });
});
```

`startApp` binds `127.0.0.1`; `/etc/hosts` maps `ghost.test` there.

- [x] **Step 11: Run the `gh` suite locally only if you are on Linux with the host mapping; otherwise rely on CI**

Run (Linux): `GH_E2E_HOST=ghost.test $E2E test/gh-cli.e2e-spec.ts`
Expected: PASS. On macOS, skip: Go ignores `SSL_CERT_FILE` there. Push and read the CI result instead.

- [x] **Step 12: Commit**

```bash
git add bun.lock apps/api/package.json apps/api/src/github apps/api/src/lib/github apps/api/src/app.module.ts apps/api/test apps/api/github.schema.gql apps/api/.gitignore
git commit -m "api: serve GraphQL at /api/graphql for GitHub compatibility, and run the real gh CLI in e2e"
```

Run `git add` from the repository root.

---

### Task 4: Token middleware, scope headers, and `/api/v3`, `/api/v3/meta`, `/api/v3/user`

**Files:**
- Create: `apps/api/src/github/auth/github-request.ts`, `apps/api/src/github/auth/github-auth.middleware.ts`, `apps/api/src/github/auth/viewer.decorator.ts`
- Create: `apps/api/src/lib/github/scopes.ts`, `apps/api/src/lib/github/github.errors.ts`
- Create: `apps/api/src/github/rest/github-rest.filter.ts`, `apps/api/src/github/rest/meta.controller.ts`, `apps/api/src/github/rest/users.controller.ts`
- Modify: `apps/api/src/github/github.module.ts`
- Create: `apps/api/test/github-rest.e2e-spec.ts`
- Modify: `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Produces `type GithubViewer = { userId: string; scopes: readonly string[] }` and `type GithubRequest = Request & { githubViewer: GithubViewer | null }`.
- Produces `@Viewer()` param decorator returning `GithubViewer | null`, working in both HTTP and GraphQL contexts.
- Produces `ALL_SCOPES: readonly string[]`.
- Produces errors: `CouldNotResolveError(message: string)` 404, `BadCredentialsError()` 401, `GithubForbiddenError(message: string)` 403, `UnprocessableError(message: string)` 422.
- Produces `GithubRestFilter` (use with `@UseFilters(GithubRestFilter)` on every compat controller).

- [x] **Step 1: Write the failing REST e2e test**

`apps/api/test/github-rest.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub REST v3', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghrest${Date.now()}`;
  const v3 = (path: string, token?: string) => {
    const call = request(app.getHttpServer()).get(`/api/v3${path}`);
    return token ? call.set('authorization', `token ${token}`) : call;
  };

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers the root with the scopes gh checks for', async () => {
    const response = await v3('/', owner.key).expect(200);
    expect(response.headers['x-oauth-scopes']).toContain('repo');
    expect(response.headers['x-oauth-scopes']).toContain('read:org');
    expect(response.headers['x-github-media-type']).toBe('github.v3; format=json');
  });

  it('accepts a Bearer token as well as token', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/user')
      .set('authorization', `Bearer ${owner.key}`)
      .expect(200);
  });

  it('refuses a wrong token with Bad credentials instead of treating it as anonymous', async () => {
    const response = await v3('/user', 'ghost_pat_nope').expect(401);
    expect(response.body).toEqual({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  });

  it('answers /user for the token owner and 401 without a token', async () => {
    const response = await v3('/user', owner.key).expect(200);
    expect(response.body).toMatchObject({ login: username, type: 'User', site_admin: false });
    expect(response.body.node_id).toMatch(/^U_/);
    expect(response.body.html_url).toMatch(new RegExp(`/${username}$`));
    const anonymous = await v3('/user').expect(401);
    expect(anonymous.body.message).toBe('Requires authentication');
  });

  it('reports an installed version below 3.18 so gh keeps the classic search syntax', async () => {
    const response = await v3('/meta').expect(200);
    expect(response.body.installed_version).toBe('3.17.0');
  });
});
```

Add to `test/github-graphql.e2e-spec.ts`:

```ts
  it('refuses a wrong token with 401 Bad credentials', async () => {
    const response = await graphql('{ __typename }', {}, 'ghost_pat_nope').expect(401);
    expect(response.body.message).toBe('Bad credentials');
  });
```

- [x] **Step 2: Run them to see them fail**

Run: `$E2E test/github-rest.e2e-spec.ts test/github-graphql.e2e-spec.ts`
Expected: FAIL, 404s on `/api/v3/*` and 200 instead of 401 on GraphQL.

- [ ] **Step 3: Types, scopes, errors**

`apps/api/src/github/auth/github-request.ts`:

```ts
import type { Request } from 'express';

export type GithubViewer = { userId: string; scopes: readonly string[] };

/** Every compat route runs the GitHub auth middleware first. */
export type GithubRequest = Request & { githubViewer: GithubViewer | null };
```

`apps/api/src/lib/github/scopes.ts`:

```ts
/** What a Ghost API key or session may do, in GitHub's scope names. Plan 2 narrows keys issued to OAuth apps. */
export const ALL_SCOPES = ['repo', 'read:org', 'write:org', 'user', 'read:user', 'user:email', 'admin:public_key', 'delete_repo', 'gist'] as const;
```

`apps/api/src/lib/github/github.errors.ts`:

```ts
import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

/** GitHub's NOT_FOUND, worded as GitHub words it, e.g. "Could not resolve to a Repository with the name 'o/r'." */
export class CouldNotResolveError extends DomainError {
  readonly status = HttpStatus.NOT_FOUND;
}

export class BadCredentialsError extends DomainError {
  readonly status = HttpStatus.UNAUTHORIZED;

  constructor() {
    super('Bad credentials');
  }
}

export class RequiresAuthenticationError extends DomainError {
  readonly status = HttpStatus.UNAUTHORIZED;

  constructor() {
    super('Requires authentication');
  }
}

export class GithubForbiddenError extends DomainError {
  readonly status = HttpStatus.FORBIDDEN;
}

export class UnprocessableError extends DomainError {
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}
```

- [x] **Step 4: Middleware**

`apps/api/src/github/auth/github-auth.middleware.ts`:

```ts
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Response } from 'express';

import type { Auth } from '../../lib/auth.js';
import { ALL_SCOPES } from '../../lib/github/scopes.js';
import type { GithubRequest, GithubViewer } from './github-request.js';

const TOKEN = /^(?:token|bearer)\s+(\S+)$/i;

/** Resolves `Authorization: token|Bearer <key>` (what gh sends) or a session cookie (GraphiQL in a browser) to a viewer, and sets the headers gh reads on every compat response. */
@Injectable()
export class GithubAuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService<Auth>) {}

  async use(req: GithubRequest, res: Response, next: NextFunction) {
    res.setHeader('X-GitHub-Media-Type', 'github.v3; format=json');
    const header = req.headers.authorization;
    const token = header ? TOKEN.exec(header)?.[1] : undefined;

    if (header && !token) return this.badCredentials(res);
    const viewer = token ? await this.fromKey(token) : await this.fromSession(req);
    if (token && !viewer) return this.badCredentials(res);

    req.githubViewer = viewer;
    res.setHeader('X-OAuth-Scopes', viewer ? viewer.scopes.join(', ') : '');
    next();
  }

  private async fromKey(key: string): Promise<GithubViewer | null> {
    const { valid, key: apiKey } = await this.auth.api.verifyApiKey({ body: { key } });
    return valid && apiKey ? { userId: apiKey.referenceId, scopes: ALL_SCOPES } : null;
  }

  private async fromSession(req: GithubRequest): Promise<GithubViewer | null> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return session ? { userId: session.user.id, scopes: ALL_SCOPES } : null;
  }

  private badCredentials(res: Response) {
    res.status(401).json({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  }
}
```

The 401 is written here rather than thrown because Apollo would otherwise wrap it in a 200 GraphQL error, and GitHub answers 401 on both APIs.

- [x] **Step 5: `@Viewer()`**

`apps/api/src/github/auth/viewer.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import type { GithubRequest, GithubViewer } from './github-request.js';

export const Viewer = createParamDecorator(
  (_: unknown, context: ExecutionContext): GithubViewer | null => {
    const req =
      context.getType<string>() === 'graphql'
        ? GqlExecutionContext.create(context).getContext<{ req: GithubRequest }>().req
        : context.switchToHttp().getRequest<GithubRequest>();
    return req.githubViewer;
  },
);
```

- [x] **Step 6: REST error filter**

`apps/api/src/github/rest/github-rest.filter.ts`:

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

import { DomainError } from '../../domain/errors.js';

const DOCUMENTATION_URL = 'https://docs.github.com/rest';

/** GitHub's REST error body, `{ message, documentation_url }`, for the compat controllers only; Ghost's own routes keep DomainErrorFilter. */
@Catch(DomainError, HttpException)
export class GithubRestFilter implements ExceptionFilter<DomainError | HttpException> {
  private readonly logger = new Logger(GithubRestFilter.name);

  catch(exception: DomainError | HttpException, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : exception.status;
    if (status >= 500) this.logger.error(exception);
    // GitHub says "Not Found" for every 404, so a private repository and a missing one read the same.
    const message = status === 404 ? 'Not Found' : exception.message;
    host.switchToHttp().getResponse<Response>().status(status).json({ message, documentation_url: DOCUMENTATION_URL });
  }
}
```

- [x] **Step 7: Meta and user controllers**

`apps/api/src/github/rest/meta.controller.ts`:

```ts
import { Controller, Get, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { GithubRestFilter } from './github-rest.filter.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class MetaController {
  @Get()
  @ApiOperation({ summary: 'GitHub API root; gh reads the X-OAuth-Scopes header it carries' })
  root() {
    return {};
  }

  @Get('meta')
  @ApiOperation({ summary: 'GitHub Enterprise meta; installed_version decides which search syntax gh uses' })
  meta() {
    return { installed_version: '3.17.0', verifiable_password_authentication: false };
  }
}
```

`apps/api/src/github/rest/users.controller.ts` (Task 13 adds `/users/:login` and Task 14 the keys routes to this file):

```ts
import { Controller, Get, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { RequiresAuthenticationError } from '../../lib/github/github.errors.js';
import { encodeNodeId } from '../../lib/github/node-id.js';
import { githubOrigins } from '../../lib/github/origins.js';
import { UsersService } from '../../services/users/users.service.js';
import type { GithubViewer } from '../auth/github-request.js';
import { Viewer } from '../auth/viewer.decorator.js';
import { GithubRestFilter } from './github-rest.filter.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('user')
  @ApiOperation({ summary: 'The authenticated user, in GitHub REST shape' })
  async me(@Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    const user = await this.users.getUserById(viewer.userId);
    const { api, web } = githubOrigins(this.config);
    return {
      login: user.username,
      id: null,
      node_id: encodeNodeId('User', user.id),
      avatar_url: user.image ?? '',
      url: `${api}/api/v3/users/${user.username}`,
      html_url: `${web}/${user.username}`,
      type: 'User',
      site_admin: false,
      name: user.name,
      email: user.email,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}
```

`encodeNodeId` comes from Task 5; write Task 5 Step 3 first if implementing strictly in order, or temporarily inline `` `U_${Buffer.from(user.id).toString('base64url')}` `` and replace it in Task 5. `id: null` because Ghost has no integer ids; GitHub clients that need `id` read `node_id`.

- [ ] **Step 8: Wire it into the module**

In `github.module.ts`:

```ts
import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
// …
import { UsersService } from '../services/users/users.service.js';
import { GithubAuthMiddleware } from './auth/github-auth.middleware.js';
import { MetaController } from './rest/meta.controller.js';
import { UsersController } from './rest/users.controller.js';

@Module({
  imports: [/* GraphQLModule as before */],
  controllers: [MetaController, UsersController],
  providers: [ViewerResolver, UsersService],
})
export class GithubModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(GithubAuthMiddleware)
      .forRoutes(
        { path: 'graphql', method: RequestMethod.ALL },
        { path: 'v3', method: RequestMethod.ALL },
        { path: 'v3/*path', method: RequestMethod.ALL },
      );
  }
}
```

- [x] **Step 9: `gh auth` case**

Add to `test/gh-cli.e2e-spec.ts`:

```ts
  it('logs in with a pasted token and reports it in auth status', async () => {
    const login = await runGh(['auth', 'login', '--hostname', GH_E2E_HOST!, '--with-token'], { configDir, input: owner.key });
    expect(login, login.stderr).toMatchObject({ code: 0 });
    const status = await runGh(['auth', 'status', '--hostname', GH_E2E_HOST!], { configDir });
    expect(status, status.stderr).toMatchObject({ code: 0 });
    expect(status.stdout + status.stderr).toContain(username);
  });

  it('answers gh api user', async () => {
    expect(JSON.parse(await ok(['api', 'user']))).toMatchObject({ login: username });
  });
```

`gh auth status` also reads `viewer { login }`, so this case passes only after Task 7. Mark it `it.todo` here and switch it to `it` in Task 7 Step 7.

- [x] **Step 10: Run the tests**

Run: `$E2E test/github-rest.e2e-spec.ts test/github-graphql.e2e-spec.ts`
Expected: PASS.

- [x] **Step 11: Commit**

```bash
git add apps/api/src/github apps/api/src/lib/github apps/api/test
git commit -m "api: resolve gh's token to a viewer and serve the v3 root, meta and user routes"
```

---

### Task 5: Node IDs and GraphQL error types

**Files:**
- Create: `apps/api/src/lib/github/node-id.ts`, `apps/api/src/lib/github/node-id.spec.ts`
- Create: `apps/api/src/lib/github/error-type.ts`, `apps/api/src/lib/github/error-type.spec.ts`
- Modify: `apps/api/src/github/github.module.ts` (`formatError`)

**Interfaces:**
- Produces `type NodeType = 'User' | 'Organization' | 'Repository' | 'Issue' | 'PullRequest' | 'IssueComment' | 'Label'`.
- Produces `encodeNodeId(type: NodeType, id: string): string`.
- Produces `decodeNodeId(nodeId: string): { type: NodeType; id: string } | null` (null for anything malformed or unknown).
- Produces `decodeNodeIdAs(nodeId: string, type: NodeType): string` which throws `CouldNotResolveError("Could not resolve to a node with the global id of '<nodeId>'")` on mismatch.
- Produces `graphqlErrorType(status: number): 'NOT_FOUND' | 'FORBIDDEN' | 'UNPROCESSABLE' | 'INTERNAL'`.

- [x] **Step 1: Failing unit tests**

`apps/api/src/lib/github/node-id.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CouldNotResolveError } from './github.errors.js';
import { decodeNodeId, decodeNodeIdAs, encodeNodeId } from './node-id.js';

describe('node ids', () => {
  it('round-trips every type with GitHub prefixes', () => {
    expect(encodeNodeId('Issue', 'issue_abc')).toMatch(/^I_/);
    expect(encodeNodeId('IssueComment', 'ic_abc')).toMatch(/^IC_/);
    expect(encodeNodeId('Label', 'label_x')).toMatch(/^LA_/);
    expect(encodeNodeId('PullRequest', 'issue_y')).toMatch(/^PR_/);
    for (const type of ['User', 'Organization', 'Repository', 'Issue', 'PullRequest', 'IssueComment', 'Label'] as const) {
      expect(decodeNodeId(encodeNodeId(type, 'some_id-1'))).toEqual({ type, id: 'some_id-1' });
    }
  });

  it('rejects unknown prefixes, missing separators and empty ids', () => {
    expect(decodeNodeId('ZZ_abc')).toBeNull();
    expect(decodeNodeId('nounderscore')).toBeNull();
    expect(decodeNodeId('I_')).toBeNull();
  });

  it('refuses an id of another type with GitHub wording', () => {
    const label = encodeNodeId('Label', 'label_x');
    expect(() => decodeNodeIdAs(label, 'Issue')).toThrow(CouldNotResolveError);
    expect(() => decodeNodeIdAs(label, 'Issue')).toThrow(`Could not resolve to a node with the global id of '${label}'`);
    expect(decodeNodeIdAs(label, 'Label')).toBe('label_x');
  });
});
```

`apps/api/src/lib/github/error-type.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { graphqlErrorType } from './error-type.js';

describe('graphqlErrorType', () => {
  it.each([
    [404, 'NOT_FOUND'],
    [401, 'FORBIDDEN'],
    [403, 'FORBIDDEN'],
    [400, 'UNPROCESSABLE'],
    [409, 'UNPROCESSABLE'],
    [422, 'UNPROCESSABLE'],
    [500, 'INTERNAL'],
  ])('maps %i to %s', (status, type) => {
    expect(graphqlErrorType(status)).toBe(type);
  });
});
```

- [x] **Step 2: Run to see failures**

Run: `bunx vitest run src/lib/github/node-id.spec.ts src/lib/github/error-type.spec.ts`
Expected: FAIL, modules not found.

- [x] **Step 3: Implement**

`apps/api/src/lib/github/node-id.ts`:

```ts
import { CouldNotResolveError } from './github.errors.js';

const PREFIXES = {
  User: 'U',
  Organization: 'O',
  Repository: 'R',
  Issue: 'I',
  PullRequest: 'PR',
  IssueComment: 'IC',
  Label: 'LA',
} as const;

export type NodeType = keyof typeof PREFIXES;

const TYPES = new Map(Object.entries(PREFIXES).map(([type, prefix]) => [prefix, type as NodeType]));

/** GitHub-style global id: the type's GitHub prefix, then the Ghost id in base64url. Opaque to clients, which only hand it back. */
export function encodeNodeId(type: NodeType, id: string) {
  return `${PREFIXES[type]}_${Buffer.from(id).toString('base64url')}`;
}

export function decodeNodeId(nodeId: string): { type: NodeType; id: string } | null {
  const separator = nodeId.indexOf('_');
  if (separator < 1) return null;
  const type = TYPES.get(nodeId.slice(0, separator));
  const id = Buffer.from(nodeId.slice(separator + 1), 'base64url').toString('utf8');
  return type && id ? { type, id } : null;
}

export function decodeNodeIdAs(nodeId: string, type: NodeType) {
  const decoded = decodeNodeId(nodeId);
  if (decoded?.type !== type) throw new CouldNotResolveError(`Could not resolve to a node with the global id of '${nodeId}'`);
  return decoded.id;
}
```

`apps/api/src/lib/github/error-type.ts`:

```ts
/** GitHub's GraphQL error `type` for a DomainError's HTTP status. gh branches on NOT_FOUND and FORBIDDEN. */
export function graphqlErrorType(status: number) {
  if (status === 404) return 'NOT_FOUND';
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status >= 400 && status < 500) return 'UNPROCESSABLE';
  return 'INTERNAL';
}
```

- [x] **Step 4: Run unit tests**

Run: `bunx vitest run src/lib/github`
Expected: PASS.

- [x] **Step 5: `formatError` in the module**

In `github.module.ts`'s `useFactory`, add:

```ts
        formatError: (formatted: GraphQLFormattedError, error: unknown) => {
          const original = error instanceof GraphQLError ? error.originalError : undefined;
          if (!(original instanceof DomainError)) return formatted;
          return { type: graphqlErrorType(original.status), path: formatted.path, locations: formatted.locations, message: original.message };
        },
```

Imports: `GraphQLError`, `type GraphQLFormattedError` from `graphql`; `DomainError` from `../domain/errors.js`; `graphqlErrorType` from `../lib/github/error-type.js`. Validation errors (unknown field) keep Apollo's shape, which `gh` prints as is.

`GraphQLFormattedError` has no `type`; if TypeScript refuses the extra key, type the return as `GraphQLFormattedError & { type: string }`.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/lib/github apps/api/src/github/github.module.ts
git commit -m "api: GitHub node ids and GraphQL error types"
```

Replace the inline `U_` encoding from Task 4 Step 7 with `encodeNodeId('User', user.id)` in the same commit if it was inlined.

---

### Task 6: Schema conformance test against GitHub's published schema

Written now so it guards every type added after it.

**Files:**
- Create: `apps/api/src/github/graphql/schema-conformance.spec.ts`

**Interfaces:** Consumes `apps/api/github.schema.gql` (generated by app start in any e2e run, and committed).

- [x] **Step 1: Write the test**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { schema as github } from '@octokit/graphql-schema';
import {
  buildSchema,
  type GraphQLNamedType,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
} from 'graphql';
import { describe, expect, it } from 'vitest';

const ours = buildSchema(readFileSync(path.join(import.meta.dirname, '../../../github.schema.gql'), 'utf8'));
const theirs = buildSchema(github.idl);

/** `[User!]!` -> `L!(N!(User))`: shape and name, so two types compare as strings. */
function shape(type: GraphQLType): string {
  if (isNonNullType(type)) return `${shape(type.ofType)}!`;
  if (isListType(type)) return `[${shape(type.ofType)}]`;
  return type.name;
}

/** Ours may be stricter than GitHub's output type (non-null where GitHub allows null) but never looser, and never a different name or list shape. */
function outputConforms(ourType: GraphQLType, theirType: GraphQLType): boolean {
  if (isNonNullType(theirType)) return isNonNullType(ourType) && outputConforms(ourType.ofType, theirType.ofType);
  if (isNonNullType(ourType)) return outputConforms(ourType.ofType, theirType);
  if (isListType(theirType)) return isListType(ourType) && outputConforms(ourType.ofType, theirType.ofType);
  return !isListType(ourType) && (ourType as GraphQLNamedType).name === (theirType as GraphQLNamedType).name;
}

const ourTypes = Object.values(ours.getTypeMap()).filter((type) => !type.name.startsWith('__') && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(type.name));

describe('github.schema.gql conforms to GitHub', () => {
  it.each(ourTypes.map((type) => [type.name, type] as const))('%s', (name, type) => {
    const theirType = theirs.getType(name);
    expect(theirType, `GitHub has no type ${name}`).toBeDefined();
    expect(theirType!.constructor.name, `${name} is a different kind of type on GitHub`).toBe(type.constructor.name);
    const problems: string[] = [];

    if ((isObjectType(type) || isInterfaceType(type)) && (isObjectType(theirType) || isInterfaceType(theirType))) {
      const theirFields = theirType.getFields();
      for (const field of Object.values(type.getFields())) {
        const theirField = theirFields[field.name];
        if (!theirField) {
          problems.push(`${name}.${field.name} does not exist on GitHub`);
          continue;
        }
        if (!outputConforms(field.type, theirField.type)) problems.push(`${name}.${field.name}: ours ${shape(field.type)}, GitHub ${shape(theirField.type)}`);
        for (const arg of field.args) {
          const theirArg = theirField.args.find((candidate) => candidate.name === arg.name);
          if (!theirArg) problems.push(`${name}.${field.name}(${arg.name}) does not exist on GitHub`);
          else if (shape(arg.type) !== shape(theirArg.type) && !(isNonNullType(theirArg.type) === false && shape(arg.type) === shape(theirArg.type).replace(/!$/, ''))) problems.push(`${name}.${field.name}(${arg.name}): ours ${shape(arg.type)}, GitHub ${shape(theirArg.type)}`);
        }
      }
      const theirInterfaces = theirType.getInterfaces().map((i) => i.name);
      for (const implemented of type.getInterfaces()) if (!theirInterfaces.includes(implemented.name)) problems.push(`${name} implements ${implemented.name}, GitHub's does not`);
    }

    if (isEnumType(type) && isEnumType(theirType)) {
      const theirValues = theirType.getValues().map((value) => value.name);
      for (const value of type.getValues()) if (!theirValues.includes(value.name)) problems.push(`${name}.${value.name} is not a GitHub value`);
    }

    if (isUnionType(type) && isUnionType(theirType)) {
      const theirMembers = theirType.getTypes().map((member) => member.name);
      for (const member of type.getTypes()) if (!theirMembers.includes(member.name)) problems.push(`${name} includes ${member.name}, GitHub's does not`);
    }

    if (isInputObjectType(type) && isInputObjectType(theirType)) {
      const theirFields = theirType.getFields();
      for (const field of Object.values(type.getFields())) {
        const theirField = theirFields[field.name];
        if (!theirField) problems.push(`${name}.${field.name} does not exist on GitHub`);
        else if (shape(field.type).replace(/!$/, '') !== shape(theirField.type).replace(/!$/, '')) problems.push(`${name}.${field.name}: ours ${shape(field.type)}, GitHub ${shape(theirField.type)}`);
        else if (isNonNullType(field.type) && !isNonNullType(theirField.type)) problems.push(`${name}.${field.name} is required here but optional on GitHub`);
      }
      for (const theirField of Object.values(theirFields)) if (isNonNullType(theirField.type) && theirField.defaultValue === undefined && !type.getFields()[theirField.name]) problems.push(`${name}.${theirField.name} is required on GitHub, so gh sends it, but missing here`);
    }

    expect(problems).toEqual([]);
  });
});
```

Arguments must match GitHub's type exactly, except that ours may be optional where GitHub's is required is **not** allowed; the condition above accepts an exact match, and accepts ours being optional only when GitHub's is optional too. Simplify the condition if the reviewer prefers: `shape(arg.type) === shape(theirArg.type) || (!isNonNullType(arg.type) && shape(arg.type) === shape(theirArg.type).replace(/!$/, ''))`. Use that simpler form; it says "same type, or ours optional where GitHub requires it" — gh always sends required arguments, so accepting them optionally is harmless.

If `import { schema } from '@octokit/graphql-schema'` fails (the package may only ship `schema.graphql`), read it instead: `readFileSync(require.resolve('@octokit/graphql-schema/schema.graphql'), 'utf8')` via `createRequire(import.meta.url)`.

- [x] **Step 2: Run it**

Run: `bunx vitest run src/github/graphql/schema-conformance.spec.ts`
Expected: FAIL on `Query.placeholder does not exist on GitHub`. That is the test working; Task 7 deletes the placeholder.

- [x] **Step 3: Commit**

```bash
git add apps/api/src/github/graphql/schema-conformance.spec.ts
git commit -m "api: check the GitHub-compatible schema against GitHub's published schema"
```

The suite is red until Task 7; that is expected on this branch.

---

### Task 7: Scalars, interfaces, User, Organization, `viewer`, `user`, `organization`, `repositoryOwner`, `node(s)`

**Files:**
- Create: `apps/api/src/github/graphql/scalars.ts`, `apps/api/src/github/graphql/enums.ts`, `apps/api/src/github/graphql/connection.ts`
- Create: `apps/api/src/github/graphql/types/node.interface.ts`, `user.type.ts`, `organization.type.ts`
- Create: `apps/api/src/lib/github/nodes.ts`, `apps/api/src/lib/github/nodes.spec.ts`
- Modify: `apps/api/src/lib/github/loaders.ts`
- Replace: `apps/api/src/github/graphql/resolvers/viewer.resolver.ts`
- Modify: `apps/api/test/github-graphql.e2e-spec.ts`, `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Produces scalars `URI`, `HTML`, `GitObjectID` (`GraphQLScalarType`s); DateTime is Nest's `GraphQLISODateTime`.
- Produces interfaces `Node { id }`, `Actor { avatarUrl login resourcePath url }`, `RepositoryOwner { avatarUrl id login resourcePath url }`, `UniformResourceLocatable { resourcePath url }`; every object node class carries a non-GraphQL `kind: string` used by `resolveType`.
- Produces `PageInfo` and `Connection<T>(node: Type<T>, name: string)` returning an `@ObjectType(`${name}Connection`)` class with `nodes: [T]` (nullable items and list), `pageInfo: PageInfo!`, `totalCount: Int!`.
- Produces in `nodes.ts`: `toUserNode(row: UserRow, origins: GithubOrigins): UserNode`, `toOrganizationNode(row: OrganizationRow, origins): OrganizationNode`.
- Produces in `loaders.ts`: `createLoaders(db)` returning `{ usersById: DataLoader<string, UserRow | null>, usersByLogin: DataLoader<string, UserRow | null> }`, and `type GraphqlContext = { req: GithubRequest; loaders: Loaders }`.

- [x] **Step 1: Failing e2e cases**

Add to `test/github-graphql.e2e-spec.ts`:

```ts
  it('answers viewer with the token owner', async () => {
    const response = await graphql('{ viewer { __typename id login name url resourcePath avatarUrl } }', {}, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.viewer).toMatchObject({ __typename: 'User', login: username, resourcePath: `/${username}` });
    expect(response.body.data.viewer.id).toMatch(/^U_/);
  });

  it('refuses viewer anonymously, as GitHub does', async () => {
    const response = await graphql('{ viewer { login } }').expect(200);
    expect(response.body.errors[0].type).toBe('FORBIDDEN');
  });

  it('resolves user, repositoryOwner and node by id', async () => {
    const response = await graphql(
      'query($login: String!) { user(login: $login) { id login } repositoryOwner(login: $login) { __typename login } }',
      { login: username },
    ).expect(200);
    expect(response.body.data.repositoryOwner).toEqual({ __typename: 'User', login: username });
    const node = await graphql('query($id: ID!) { node(id: $id) { __typename ... on User { login } } }', { id: response.body.data.user.id }).expect(200);
    expect(node.body.data.node).toEqual({ __typename: 'User', login: username });
  });

  it('answers a missing user as NOT_FOUND with GitHub wording', async () => {
    const response = await graphql('{ user(login: "nobody-here-xyz") { login } }').expect(200);
    expect(response.body.data.user).toBeNull();
    expect(response.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: "Could not resolve to a User with the login of 'nobody-here-xyz'." });
  });
```

Run: `$E2E test/github-graphql.e2e-spec.ts` — Expected: FAIL.

- [x] **Step 2: Scalars, connection, interfaces**

`apps/api/src/github/graphql/scalars.ts`:

```ts
import { GraphQLScalarType, Kind } from 'graphql';

function stringScalar(name: string, description: string) {
  return new GraphQLScalarType({
    name,
    description,
    serialize: (value) => String(value),
    parseValue: (value) => String(value),
    parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
  });
}

export const URI = stringScalar('URI', 'An RFC 3986, RFC 3987, and RFC 6570 (level 4) compliant URI string.');
export const HTML = stringScalar('HTML', 'A string containing HTML code.');
export const GitObjectID = stringScalar('GitObjectID', 'A Git object ID.');
```

`apps/api/src/github/graphql/connection.ts`:

```ts
import type { Type } from '@nestjs/common';
import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('PageInfo')
export class PageInfo {
  @Field(() => String, { nullable: true })
  endCursor: string | null;

  @Field()
  hasNextPage: boolean;

  @Field()
  hasPreviousPage: boolean;

  @Field(() => String, { nullable: true })
  startCursor: string | null;
}

export type ConnectionOf<T> = { nodes: T[]; pageInfo: PageInfo; totalCount: number };

/** GitHub's `<Name>Connection`. Edges are left out until a client asks for them; gh reads `nodes`. */
export function Connection<T>(node: Type<T>, name: string) {
  @ObjectType(`${name}Connection`)
  class ConnectionType implements ConnectionOf<T> {
    @Field(() => [node], { nullable: 'itemsAndList' })
    nodes: T[];

    @Field(() => PageInfo)
    pageInfo: PageInfo;

    @Field(() => Int)
    totalCount: number;
  }
  return ConnectionType;
}

/** One page of a list that is already fully in memory, such as an issue's labels. `first`/`last` slice it as GitHub does. */
export function sliceConnection<T>(items: T[], { first, last }: { first?: number | null; last?: number | null }): ConnectionOf<T> {
  const nodes = last ? items.slice(-last) : items.slice(0, first ?? items.length);
  return {
    nodes,
    totalCount: items.length,
    pageInfo: {
      hasNextPage: !last && nodes.length < items.length,
      hasPreviousPage: !!last && nodes.length < items.length,
      startCursor: null,
      endCursor: null,
    },
  };
}
```

`apps/api/src/github/graphql/types/node.interface.ts`:

```ts
import { Field, ID, InterfaceType } from '@nestjs/graphql';

import { URI } from '../scalars.js';

/** Every node class sets `kind` to its GraphQL type name; it is how interfaces and unions resolve. */
export type Kinded = { kind: string };
const resolveType = (value: Kinded) => value.kind;

@InterfaceType('Node', { resolveType })
export abstract class Node {
  @Field(() => ID)
  id: string;
}

@InterfaceType('UniformResourceLocatable', { resolveType })
export abstract class UniformResourceLocatable {
  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}

@InterfaceType('Actor', { resolveType })
export abstract class Actor {
  @Field(() => URI)
  avatarUrl: string;

  @Field()
  login: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}

@InterfaceType('RepositoryOwner', { resolveType })
export abstract class RepositoryOwner {
  @Field(() => URI)
  avatarUrl: string;

  @Field(() => ID)
  id: string;

  @Field()
  login: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}
```

GitHub's `avatarUrl` takes `size: Int`; it is optional, so leaving it out conforms. Task 8 adds `RepositoryOwner.repository(name:)` once `Repository` exists.

- [x] **Step 3: User and Organization types**

`apps/api/src/github/graphql/types/user.type.ts`:

```ts
import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { URI } from '../scalars.js';
import { Actor, Node, RepositoryOwner, UniformResourceLocatable } from './node.interface.js';

@ObjectType('User', { implements: () => [Node, Actor, RepositoryOwner, UniformResourceLocatable] })
export class UserNode {
  kind = 'User';
  /** Ghost id, for resolvers; not a GraphQL field. */
  ghostId: string;

  @Field(() => ID)
  id: string;

  @Field()
  login: string;

  @Field(() => String, { nullable: true })
  name: string | null;

  @Field(() => URI)
  avatarUrl: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;
}
```

`apps/api/src/github/graphql/types/organization.type.ts`:

```ts
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { URI } from '../scalars.js';
import { Actor, Node, RepositoryOwner, UniformResourceLocatable } from './node.interface.js';

@ObjectType('Organization', { implements: () => [Node, Actor, RepositoryOwner, UniformResourceLocatable] })
export class OrganizationNode {
  kind = 'Organization';
  ghostId: string;

  @Field(() => ID)
  id: string;

  @Field()
  login: string;

  @Field(() => String, { nullable: true })
  name: string | null;

  @Field(() => URI)
  avatarUrl: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;
}
```

- [x] **Step 4: Mappers and their unit test**

`apps/api/src/lib/github/nodes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { toOrganizationNode, toUserNode } from './nodes.js';

const origins = { api: 'https://api.ghost.test', web: 'https://ghost.test', sshHost: 'ghost.test:1031' };

describe('toUserNode', () => {
  it('builds GitHub user fields from a Ghost user row', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const node = toUserNode({ id: 'u1', username: 'ada', name: 'Ada', image: null, createdAt: created } as never, origins);
    expect(node).toMatchObject({ kind: 'User', ghostId: 'u1', login: 'ada', name: 'Ada', avatarUrl: '', resourcePath: '/ada', url: 'https://ghost.test/ada', databaseId: null, createdAt: created });
    expect(node.id).toMatch(/^U_/);
  });
});

describe('toOrganizationNode', () => {
  it('uses the slug as the login', () => {
    const node = toOrganizationNode({ id: 'o1', slug: 'acme', name: 'Acme', logo: 'https://x/logo.png' } as never, origins);
    expect(node).toMatchObject({ kind: 'Organization', login: 'acme', avatarUrl: 'https://x/logo.png', url: 'https://ghost.test/acme' });
    expect(node.id).toMatch(/^O_/);
  });
});
```

`apps/api/src/lib/github/nodes.ts` (later tasks append mappers to this file):

```ts
import type { schema } from '@ghost/db';

import { OrganizationNode } from '../../github/graphql/types/organization.type.js';
import { UserNode } from '../../github/graphql/types/user.type.js';
import { encodeNodeId } from './node-id.js';
import type { GithubOrigins } from './origins.js';

export type UserRow = typeof schema.user.$inferSelect;
export type OrganizationRow = typeof schema.organization.$inferSelect;

// Mapper: loaders hand back whole rows shared by several GraphQL types, so the GitHub shape cannot be selected in the query.
export function toUserNode(row: UserRow, { web }: GithubOrigins) {
  const login = row.username ?? '';
  return Object.assign(new UserNode(), {
    ghostId: row.id,
    id: encodeNodeId('User', row.id),
    login,
    name: row.name,
    avatarUrl: row.image ?? '',
    resourcePath: `/${login}`,
    url: `${web}/${login}`,
    databaseId: null,
    createdAt: row.createdAt,
  });
}

// Mapper: same reason as toUserNode.
export function toOrganizationNode(row: OrganizationRow, { web }: GithubOrigins) {
  return Object.assign(new OrganizationNode(), {
    ghostId: row.id,
    id: encodeNodeId('Organization', row.id),
    login: row.slug,
    name: row.name,
    avatarUrl: row.logo ?? '',
    resourcePath: `/${row.slug}`,
    url: `${web}/${row.slug}`,
    databaseId: null,
  });
}
```

Check the organization table's column names first (`sed -n 101,113p packages/db/src/schema/auth.ts`); if the slug or logo column is named differently, use the real names in both files.

Run: `bunx vitest run src/lib/github/nodes.spec.ts` — Expected: PASS.

- [x] **Step 5: Loaders**

Replace `apps/api/src/lib/github/loaders.ts`:

```ts
import { type Database, schema } from '@ghost/db';
import DataLoader from 'dataloader';
import { inArray } from 'drizzle-orm';

import type { GithubRequest } from '../../github/auth/github-request.js';
import type { UserRow } from './nodes.js';

function byKey<Row>(rows: Row[], key: (row: Row) => string | null) {
  return new Map(rows.flatMap((row) => { const k = key(row); return k ? [[k, row] as const] : []; }));
}

/** Per-request batch loaders; one set per GraphQL request so nothing is cached across viewers. */
export function createLoaders(db: Database) {
  return {
    usersById: new DataLoader<string, UserRow | null>(async (ids) => {
      const found = byKey(await db.select().from(schema.user).where(inArray(schema.user.id, [...ids])), (row) => row.id);
      return ids.map((id) => found.get(id) ?? null);
    }),
    usersByLogin: new DataLoader<string, UserRow | null>(async (logins) => {
      const found = byKey(await db.select().from(schema.user).where(inArray(schema.user.username, [...logins])), (row) => row.username);
      return logins.map((login) => found.get(login) ?? null);
    }),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
export type GraphqlContext = { req: GithubRequest; loaders: Loaders };
```

- [x] **Step 6: Viewer resolver**

Replace `apps/api/src/github/graphql/resolvers/viewer.resolver.ts`:

```ts
import { type Database, schema } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Args, Context, createUnionType, ID, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { CouldNotResolveError, GithubForbiddenError } from '../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../lib/github/loaders.js';
import { decodeNodeId } from '../../../lib/github/node-id.js';
import { toOrganizationNode, toUserNode } from '../../../lib/github/nodes.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { Node, RepositoryOwner } from '../types/node.interface.js';
import { OrganizationNode } from '../types/organization.type.js';
import { UserNode } from '../types/user.type.js';

@Resolver()
@AllowAnonymous()
export class ViewerResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  @Query(() => UserNode, { description: 'The currently authenticated user.' })
  async viewer(@Viewer() viewer: GithubViewer | null, @Context() { loaders }: GraphqlContext) {
    if (!viewer) throw new GithubForbiddenError('This endpoint requires you to be authenticated.');
    const row = await loaders.usersById.load(viewer.userId);
    if (!row) throw new GithubForbiddenError('This endpoint requires you to be authenticated.');
    return toUserNode(row, githubOrigins(this.config));
  }

  @Query(() => UserNode, { nullable: true })
  async user(@Args('login') login: string, @Context() { loaders }: GraphqlContext) {
    const row = await loaders.usersByLogin.load(login);
    if (!row) throw new CouldNotResolveError(`Could not resolve to a User with the login of '${login}'.`);
    return toUserNode(row, githubOrigins(this.config));
  }

  @Query(() => OrganizationNode, { nullable: true })
  async organization(@Args('login') login: string) {
    const [row] = await this.db.select().from(schema.organization).where(eq(schema.organization.slug, login));
    if (!row) throw new CouldNotResolveError(`Could not resolve to an Organization with the login of '${login}'.`);
    return toOrganizationNode(row, githubOrigins(this.config));
  }

  @Query(() => RepositoryOwner, { nullable: true })
  async repositoryOwner(@Args('login') login: string, @Context() context: GraphqlContext) {
    const [organization] = await this.db.select().from(schema.organization).where(eq(schema.organization.slug, login));
    if (organization) return toOrganizationNode(organization, githubOrigins(this.config));
    const user = await context.loaders.usersByLogin.load(login);
    return user ? toUserNode(user, githubOrigins(this.config)) : null;
  }

  @Query(() => Node, { nullable: true })
  async node(@Args('id', { type: () => ID }) id: string, @Context() context: GraphqlContext) {
    const found = await this.lookup(id, context);
    if (!found) throw new CouldNotResolveError(`Could not resolve to a node with the global id of '${id}'`);
    return found;
  }

  @Query(() => [Node], { nullable: 'items' })
  nodes(@Args('ids', { type: () => [ID] }) ids: string[], @Context() context: GraphqlContext) {
    return Promise.all(ids.map((id) => this.lookup(id, context)));
  }

  /** Later tasks add Repository, Issue, IssueComment and Label here. */
  private async lookup(id: string, { loaders }: GraphqlContext) {
    const decoded = decodeNodeId(id);
    if (decoded?.type === 'User') {
      const row = await loaders.usersById.load(decoded.id);
      return row ? toUserNode(row, githubOrigins(this.config)) : null;
    }
    if (decoded?.type === 'Organization') {
      const [row] = await this.db.select().from(schema.organization).where(eq(schema.organization.id, decoded.id));
      return row ? toOrganizationNode(row, githubOrigins(this.config)) : null;
    }
    return null;
  }
}
```

Drop the unused `createUnionType` import. Register `ConfigService` availability: `ConfigModule` is global, nothing to import.

Note: `user` and `organization` here fetch anyone by login, as GitHub does; Ghost profiles are public.

- [x] **Step 7: Run the tests and switch on the `gh auth` case**

Run: `$E2E test/github-graphql.e2e-spec.ts` — Expected: PASS.
Run: `bunx vitest run src/github/graphql/schema-conformance.spec.ts` — Expected: PASS (the e2e run regenerated `github.schema.gql`).
In `test/gh-cli.e2e-spec.ts`, change the `it.todo` from Task 4 Step 9 to `it`.

- [x] **Step 8: Commit**

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: GitHub User, Organization, viewer, owner and node queries"
```

---

### Task 8: Repository: `repository(owner, name)`, Repository fields, REST repo and readme

**Files:**
- Create: `apps/api/src/github/graphql/types/repository.type.ts`, `apps/api/src/lib/github/permission.ts`, `apps/api/src/lib/github/permission.spec.ts`
- Create: `apps/api/src/github/graphql/resolvers/repository.resolver.ts`, `apps/api/src/github/rest/repos.controller.ts`
- Modify: `apps/api/src/github/graphql/enums.ts`, `apps/api/src/lib/github/nodes.ts`, `node.interface.ts` (`RepositoryOwner.repository`), `viewer.resolver.ts` (`lookup` for `Repository`), `github.module.ts`
- Modify: tests

**Interfaces:**
- Produces `RepositoryNode` with non-GraphQL `ghostId`, `ownerLogin`, `slug`, `ownerGhostId`, `organizationGhostId: string | null`, `parentGhostId: string | null`, `viewerRole: Role | null`.
- Produces `toRepositoryNode(row: AuthorizedRepository, ownerLogin: string, origins): RepositoryNode`.
- Produces `repositoryPermissionOf(role: Role | null): 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ' | null`.
- Produces `RepositoryResolver.authorizeOrNotFound(owner: string, name: string, requesterId?: string, operation?: RepositoryOperation): Promise<AuthorizedRepository>`, exported as a function `authorizeOrNotFound(access, …)` in `apps/api/src/lib/github/authorize.ts` so the issue resolvers reuse it. It maps `RepositoryNotFoundError` and `AuthenticationRequiredError` to `CouldNotResolveError("Could not resolve to a Repository with the name 'owner/name'.")`.

- [ ] **Step 1: Failing tests**

`apps/api/src/lib/github/permission.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { repositoryPermissionOf } from './permission.js';

describe('repositoryPermissionOf', () => {
  it.each([
    ['owner', 'ADMIN'],
    ['admin', 'ADMIN'],
    ['maintain', 'MAINTAIN'],
    ['write', 'WRITE'],
    ['triage', 'TRIAGE'],
    ['read', 'READ'],
    [null, null],
  ] as const)('%s -> %s', (role, permission) => {
    expect(repositoryPermissionOf(role)).toBe(permission);
  });
});
```

Add to `test/github-graphql.e2e-spec.ts` (needs a repository; create it in `beforeAll` through Ghost's own API):

```ts
  // in beforeAll, after signUp:
  //   const api = request(app.getHttpServer());
  //   await api.post('/api/repositories').set('cookie', owner.cookie).send({ name: 'public-repo', visibility: 'public' }).expect(201);
  //   await api.post('/api/repositories').set('cookie', owner.cookie).send({ name: 'secret-repo', visibility: 'private' }).expect(201);
  //   stranger = await signUp(app, `${username}x`);

  const REPO_QUERY = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id databaseId name nameWithOwner owner { login } sshUrl url hasIssuesEnabled hasWikiEnabled description isPrivate visibility viewerPermission defaultBranchRef { name } parent { name } mergeCommitAllowed rebaseMergeAllowed squashMergeAllowed } }';

  it('answers the repository fields gh reads before every command', async () => {
    const response = await graphql(REPO_QUERY, { owner: username, name: 'public-repo' }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository).toMatchObject({
      databaseId: null,
      name: 'public-repo',
      nameWithOwner: `${username}/public-repo`,
      owner: { login: username },
      hasIssuesEnabled: true,
      hasWikiEnabled: false,
      isPrivate: false,
      visibility: 'PUBLIC',
      viewerPermission: 'ADMIN',
      parent: null,
      mergeCommitAllowed: true,
    });
    expect(response.body.data.repository.id).toMatch(/^R_/);
  });

  it.each([
    ['anonymous', () => undefined],
    ['a stranger', () => stranger.key],
  ])('answers a private repository as NOT_FOUND for %s', async (_, token) => {
    const response = await graphql(REPO_QUERY, { owner: username, name: 'secret-repo' }, token()).expect(200);
    expect(response.body.data.repository).toBeNull();
    expect(response.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: `Could not resolve to a Repository with the name '${username}/secret-repo'.` });
  });
```

Declare `let stranger: { cookie: string; key: string; userId: string };` beside `owner`.

Add to `test/github-rest.e2e-spec.ts` (create `public-repo` the same way in `beforeAll`):

```ts
  it('answers GET /repos/:owner/:repo in REST shape and 404 for a private one anonymously', async () => {
    const response = await v3(`/repos/${username}/public-repo`, owner.key).expect(200);
    expect(response.body).toMatchObject({ name: 'public-repo', full_name: `${username}/public-repo`, private: false, visibility: 'public', owner: { login: username } });
    expect(response.body.clone_url).toMatch(new RegExp(`/${username}/public-repo\\.git$`));
    await v3(`/repos/${username}/secret-repo`).expect(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' });
  });

  it('answers the readme as base64 content, and 404 when there is none', async () => {
    await v3(`/repos/${username}/public-repo/readme`, owner.key).expect(404);
  });
```

(A readme with content is covered by the `gh repo view` case in Step 8, which pushes one.)

Run both; Expected: FAIL.

- [x] **Step 2: Enums**

`apps/api/src/github/graphql/enums.ts` (later tasks append):

```ts
import { registerEnumType } from '@nestjs/graphql';

export enum RepositoryVisibility { PRIVATE = 'PRIVATE', PUBLIC = 'PUBLIC' }
registerEnumType(RepositoryVisibility, { name: 'RepositoryVisibility' });

export enum RepositoryPermission { ADMIN = 'ADMIN', MAINTAIN = 'MAINTAIN', WRITE = 'WRITE', TRIAGE = 'TRIAGE', READ = 'READ' }
registerEnumType(RepositoryPermission, { name: 'RepositoryPermission' });
```

- [x] **Step 3: Permission mapping**

`apps/api/src/lib/github/permission.ts`:

```ts
import type { Role } from '@ghost/permissions';

/** GitHub has no `owner` permission; a repository's owner holds ADMIN there. */
export function repositoryPermissionOf(role: Role | null) {
  if (!role) return null;
  if (role === 'owner' || role === 'admin') return 'ADMIN';
  return role.toUpperCase() as 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ';
}
```

Run: `bunx vitest run src/lib/github/permission.spec.ts` — Expected: PASS.

- [x] **Step 4: Repository type**

`apps/api/src/github/graphql/types/repository.type.ts`:

```ts
import type { Role } from '@ghost/permissions';
import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { RepositoryPermission, RepositoryVisibility } from '../enums.js';
import { URI } from '../scalars.js';
import { Node, RepositoryOwner, UniformResourceLocatable } from './node.interface.js';

@ObjectType('Ref', { implements: () => [Node] })
export class RefNode {
  kind = 'Ref';

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  prefix: string;
}

@ObjectType('Repository', { implements: () => [Node, UniformResourceLocatable] })
export class RepositoryNode {
  kind = 'Repository';
  ghostId: string;
  ownerGhostId: string;
  organizationGhostId: string | null;
  parentGhostId: string | null;
  ownerLogin: string;
  slug: string;
  defaultBranch: string | null;
  viewerRole: Role | null;

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field()
  name: string;

  @Field()
  nameWithOwner: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field()
  isPrivate: boolean;

  @Field()
  isFork: boolean;

  @Field()
  isArchived: boolean;

  @Field()
  isEmpty: boolean;

  @Field(() => RepositoryVisibility)
  visibility: RepositoryVisibility;

  @Field()
  hasIssuesEnabled: boolean;

  @Field()
  hasWikiEnabled: boolean;

  @Field()
  hasProjectsEnabled: boolean;

  @Field()
  mergeCommitAllowed: boolean;

  @Field()
  rebaseMergeAllowed: boolean;

  @Field()
  squashMergeAllowed: boolean;

  @Field()
  sshUrl: string;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  pushedAt: Date | null;

  @Field(() => RepositoryPermission, { nullable: true })
  viewerPermission: RepositoryPermission | null;
}

export const RepositoryConnection = Connection(RepositoryNode, 'Repository');
```

`owner`, `parent`, `defaultBranchRef`, `labels`, `assignableUsers`, `issues`, `issue`, `issueOrPullRequest` are field resolvers (this task and Tasks 9–10). If the conformance test says `sshUrl` must be `GitSSHRemote`, change the type to a `GitSSHRemote` scalar defined in `scalars.ts` like `URI`; GitHub declares `sshUrl: GitSSHRemote!`.

- [x] **Step 5: Mapper and shared authorization**

Append to `apps/api/src/lib/github/nodes.ts`:

```ts
import type { AuthorizedRepository } from '../repositories/access/repository-access.js';
import { RepositoryNode } from '../../github/graphql/types/repository.type.js';
import { RepositoryPermission, RepositoryVisibility } from '../../github/graphql/enums.js';
import { repositoryPermissionOf } from './permission.js';

// Mapper: the access service returns the row the permission check already loaded; re-querying it in GitHub's shape would read it twice.
export function toRepositoryNode(row: AuthorizedRepository, ownerLogin: string, { web, sshHost }: GithubOrigins) {
  const permission = repositoryPermissionOf(row.viewerRole);
  return Object.assign(new RepositoryNode(), {
    ghostId: row.id,
    ownerGhostId: row.ownerId,
    organizationGhostId: row.organizationId,
    parentGhostId: row.parentRepositoryId,
    ownerLogin,
    slug: row.slug,
    defaultBranch: row.defaultBranch,
    viewerRole: row.viewerRole,
    id: encodeNodeId('Repository', row.id),
    databaseId: null,
    name: row.slug,
    nameWithOwner: `${ownerLogin}/${row.slug}`,
    description: row.description,
    isPrivate: row.visibility === 'private',
    isFork: row.parentRepositoryId !== null,
    isArchived: false,
    isEmpty: false,
    visibility: row.visibility === 'private' ? RepositoryVisibility.PRIVATE : RepositoryVisibility.PUBLIC,
    hasIssuesEnabled: true,
    hasWikiEnabled: false,
    hasProjectsEnabled: false,
    // ponytail: Ghost allows every merge method on every repository; read per-repository settings here once they exist.
    mergeCommitAllowed: true,
    rebaseMergeAllowed: true,
    squashMergeAllowed: true,
    sshUrl: sshHost ? `ssh://git@${sshHost}/${ownerLogin}/${row.slug}.git` : '',
    url: `${web}/${ownerLogin}/${row.slug}`,
    resourcePath: `/${ownerLogin}/${row.slug}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pushedAt: row.lastPushedAt,
    viewerPermission: permission ? RepositoryPermission[permission] : null,
  });
}
```

`isEmpty: false` is a deliberate simplification: `gh repo view` only uses it to choose a message. Add a `// ponytail:` note if the reviewer wants it; Ghost's materializer knows emptiness but reading it costs a git call per repository.

`apps/api/src/lib/github/authorize.ts`:

```ts
import { ownerNameOf, type RepositoryOperation } from '../repositories/access/repository-access.js';
import { AuthenticationRequiredError } from '../repositories/access/repository-access.errors.js';
import { RepositoryNotFoundError } from '../repositories/repositories.errors.js';
import type { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { CouldNotResolveError } from './github.errors.js';

/** The access check, with "can't see it" in GitHub's words: anonymous and stranger reads of a private repository both read as missing. */
export async function authorizeOrNotFound(
  access: RepositoryAccessService,
  { owner, name, requesterId, operation }: { owner: string; name: string; requesterId?: string; operation?: RepositoryOperation },
) {
  try {
    return await access.authorize({ username: owner, repo: name, requesterId, operation });
  } catch (error) {
    if (error instanceof RepositoryNotFoundError || error instanceof AuthenticationRequiredError) {
      throw new CouldNotResolveError(`Could not resolve to a Repository with the name '${owner}/${name}'.`);
    }
    throw error;
  }
}
```

Drop the unused `ownerNameOf` import. `access.authorize` follows renames, so `ownerLogin` must come from the row, not the request: resolve it with one query, `select ownerNameOf(user, organization) from repository join user left join organization where repository.id = …`. Put that query in the resolver as a private `ownerLoginOf(repositoryId)`.

- [x] **Step 6: Resolver**

`apps/api/src/github/graphql/resolvers/repository.resolver.ts`:

```ts
import { type Database, schema } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Args, Context, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { authorizeOrNotFound } from '../../../lib/github/authorize.js';
import type { GraphqlContext } from '../../../lib/github/loaders.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import { toOrganizationNode, toRepositoryNode, toUserNode } from '../../../lib/github/nodes.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { ownerNameOf } from '../../../lib/repositories/access/repository-access.js';
import { RepositoryAccessService } from '../../../services/git/repository-access/repository-access.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { RepositoryOwner } from '../types/node.interface.js';
import { RefNode, RepositoryNode } from '../types/repository.type.js';

@Resolver(() => RepositoryNode)
@AllowAnonymous()
export class RepositoryResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly config: ConfigService,
  ) {}

  @Query(() => RepositoryNode, { nullable: true })
  async repository(@Args('owner') owner: string, @Args('name') name: string, @Viewer() viewer: GithubViewer | null) {
    const row = await authorizeOrNotFound(this.access, { owner, name, requesterId: viewer?.userId });
    return this.toNode(row.id, row);
  }

  /** The node for a repository already authorized, for other resolvers (issue.repository, node(id:)). */
  async load(repositoryId: string, requesterId?: string) {
    const row = await this.access.authorizeById({ repositoryId, requesterId });
    return this.toNode(repositoryId, row);
  }

  @ResolveField(() => RepositoryOwner)
  async owner(@Parent() repository: RepositoryNode, @Context() { loaders }: GraphqlContext) {
    const origins = githubOrigins(this.config);
    if (repository.organizationGhostId) {
      const [organization] = await this.db.select().from(schema.organization).where(eq(schema.organization.id, repository.organizationGhostId));
      return toOrganizationNode(organization!, origins);
    }
    return toUserNode((await loaders.usersById.load(repository.ownerGhostId))!, origins);
  }

  @ResolveField(() => RepositoryNode, { nullable: true })
  async parent(@Parent() repository: RepositoryNode, @Viewer() viewer: GithubViewer | null) {
    if (!repository.parentGhostId) return null;
    // A parent the viewer cannot read reads as no parent, as on GitHub.
    return this.load(repository.parentGhostId, viewer?.userId).catch(() => null);
  }

  @ResolveField(() => RefNode, { nullable: true })
  defaultBranchRef(@Parent() repository: RepositoryNode) {
    const name = repository.defaultBranch ?? 'main';
    return Object.assign(new RefNode(), { id: encodeNodeId('Repository', `${repository.ghostId}:refs/heads/${name}`), name, prefix: 'refs/heads/' });
  }

  private async toNode(repositoryId: string, row: Awaited<ReturnType<RepositoryAccessService['authorize']>>) {
    const [owner] = await this.db
      .select({ login: ownerNameOf(schema.user, schema.organization) })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(schema.organization, eq(schema.organization.id, schema.repository.organizationId))
      .where(eq(schema.repository.id, repositoryId));
    return toRepositoryNode(row, owner!.login, githubOrigins(this.config));
  }
}
```

`defaultBranch` is null until the materializer picks one. Read the actual default branch with the same helper `RepositoriesService.getRepository` uses for its `ref` (look for `defaultBranch` handling in `openRepository`, around line 1936) and use it instead of `'main'`; if that needs the git directory, inject `RepositoryStorageService` and call the same function. The `Ref` id reuses the `Repository` prefix only because `Ref` has no node lookup yet; give it a `REF_` prefix in `node-id.ts` if the reviewer objects.

- [x] **Step 7: `RepositoryOwner.repository(name:)`, `node(id:)` for repositories, REST controller**

Add to the `RepositoryOwner` interface a field resolver on both `UserNode` and `OrganizationNode`:

```ts
// in repository.resolver.ts
@Resolver(() => UserNode)
@AllowAnonymous()
export class UserRepositoryResolver {
  constructor(private readonly repositories: RepositoryResolver, private readonly access: RepositoryAccessService) {}

  @ResolveField(() => RepositoryNode, { nullable: true })
  async repository(@Parent() owner: UserNode, @Args('name') name: string, @Viewer() viewer: GithubViewer | null) {
    return this.repositories.repository(owner.login, name, viewer).catch(() => null);
  }
}
```

and the same class for `OrganizationNode` (`OrganizationRepositoryResolver`). Declare `repository(name: String!): Repository` on the `RepositoryOwner` interface class too, as an abstract `@Field(() => RepositoryNode, { nullable: true })` with an `@Args` — if Nest refuses arguments on interface fields, leave it off the interface; the conformance test accepts the interface as a subset.

In `ViewerResolver.lookup`, add a `Repository` branch that calls `this.repositories.load(decoded.id, viewer?.userId).catch(() => null)`; inject `RepositoryResolver` and pass the viewer from `context.req.githubViewer`.

`apps/api/src/github/rest/repos.controller.ts`:

```ts
import { Controller, Get, NotFoundException, Param, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { githubOrigins } from '../../lib/github/origins.js';
import { RepositoriesService } from '../../resources/repositories/repositories.service.js';
import type { GithubViewer } from '../auth/github-request.js';
import { Viewer } from '../auth/viewer.decorator.js';
import { RepositoryResolver } from '../graphql/resolvers/repository.resolver.js';
import { GithubRestFilter } from './github-rest.filter.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class ReposController {
  constructor(
    private readonly repositoryNodes: RepositoryResolver,
    private readonly repositories: RepositoriesService,
    private readonly config: ConfigService,
  ) {}

  @Get('repos/:owner/:repo')
  @ApiOperation({ summary: 'A repository, in GitHub REST shape' })
  async get(@Param('owner') owner: string, @Param('repo') repo: string, @Viewer() viewer: GithubViewer | null) {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    const { api, web } = githubOrigins(this.config);
    return {
      id: null,
      node_id: node.id,
      name: node.name,
      full_name: node.nameWithOwner,
      private: node.isPrivate,
      visibility: node.isPrivate ? 'private' : 'public',
      owner: { login: node.ownerLogin, html_url: `${web}/${node.ownerLogin}` },
      html_url: node.url,
      description: node.description,
      fork: node.isFork,
      url: `${api}/api/v3/repos/${node.nameWithOwner}`,
      clone_url: `${api}/${node.nameWithOwner}.git`,
      ssh_url: node.sshUrl,
      default_branch: node.defaultBranch ?? 'main',
      created_at: node.createdAt.toISOString(),
      updated_at: node.updatedAt.toISOString(),
      pushed_at: node.pushedAt?.toISOString() ?? null,
      has_issues: node.hasIssuesEnabled,
      permissions: node.viewerPermission && {
        admin: node.viewerPermission === 'ADMIN',
        maintain: ['ADMIN', 'MAINTAIN'].includes(node.viewerPermission),
        push: ['ADMIN', 'MAINTAIN', 'WRITE'].includes(node.viewerPermission),
        triage: node.viewerPermission !== 'READ',
        pull: true,
      },
    };
  }

  @Get('repos/:owner/:repo/readme')
  @ApiOperation({ summary: "The repository's README at the default branch, base64 as GitHub returns it" })
  async readme(@Param('owner') owner: string, @Param('repo') repo: string, @Viewer() viewer: GithubViewer | null) {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    const readme = await this.repositories.getRepositoryReadme({ username: node.ownerLogin, repo: node.slug, requesterId: viewer?.userId });
    if (!readme.path || readme.content === null) throw new NotFoundException();
    return {
      type: 'file',
      encoding: 'base64',
      size: readme.size,
      name: readme.path.split('/').at(-1),
      path: readme.path,
      content: Buffer.from(readme.content).toString('base64'),
    };
  }
}
```

`repositoryNodes.repository` throws `CouldNotResolveError` (404), which `GithubRestFilter` answers as "Not Found". The REST object is built in the controller where it is returned, per code standard 2.

Register in `GithubModule`: `imports: [RepositoriesModule, …]` (it exports `RepositoriesService`), providers `RepositoryResolver`, `UserRepositoryResolver`, `OrganizationRepositoryResolver`, `RepositoryAccessService`, controller `ReposController`. `RepositoryAccessService` is not exported by any module; providing it again in `GithubModule` matches how `IssuesModule` and `RepositoriesModule` each provide it.

- [x] **Step 8: `gh repo view` and `gh repo clone` cases**

Add to `test/gh-cli.e2e-spec.ts` (`beforeAll` creates `public-repo` through Ghost's API, then pushes a README with git over HTTPS using the key):

```ts
  // in beforeAll, after configDir:
  //   await request(app.getHttpServer()).post('/api/repositories').set('cookie', owner.cookie).send({ name: 'tools', visibility: 'public' }).expect(201);
  //   const work = mkdtempSync(path.join(tmpdir(), 'gh-e2e-work-'));
  //   const git = (...args: string[]) => promisify(execFile)('git', args, { cwd: work, env: { ...process.env, GIT_SSL_CAINFO: tlsFiles().certPath } });
  //   await git('init', '-q', '-b', 'main');
  //   writeFileSync(path.join(work, 'README.md'), '# Tools\n\nHello from Ghost.\n');
  //   await git('add', '.');
  //   await git('-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'readme');
  //   await git('push', '-q', `https://${username}:${owner.key}@${GH_E2E_HOST}/${username}/tools.git`, 'main');

  it('views a repository with its README', async () => {
    const out = await ok(['repo', 'view', `${GH_E2E_HOST}/${username}/tools`]);
    expect(out).toContain(`${username}/tools`);
    expect(out).toContain('Hello from Ghost.');
  });

  it('views a repository as JSON', async () => {
    const out = await ok(['repo', 'view', `${GH_E2E_HOST}/${username}/tools`, '--json', 'name,owner,visibility,defaultBranchRef']);
    expect(JSON.parse(out)).toMatchObject({ name: 'tools', owner: { login: username }, visibility: 'PUBLIC', defaultBranchRef: { name: 'main' } });
  });

  it('clones a repository', async () => {
    const target = path.join(configDir, 'clone');
    await ok(['repo', 'clone', `${GH_E2E_HOST}/${username}/tools`, target]);
    expect(readFileSync(path.join(target, 'README.md'), 'utf8')).toContain('Hello from Ghost.');
  });
```

`gh repo clone` uses git's credential helper; with `GH_ENTERPRISE_TOKEN` set and `gh auth setup-git` not run, the clone of a public repository needs no credentials. Imports to add: `execFile` from `node:child_process`, `readFileSync`, `writeFileSync` from `node:fs`, `promisify` from `node:util`, `request` from `supertest`.

If `gh repo view --json visibility` asks for a field the conformance test does not yet allow, add it to `RepositoryNode` and re-run the conformance test.

- [x] **Step 9: Run everything**

Run: `$E2E test/github-graphql.e2e-spec.ts test/github-rest.e2e-spec.ts`, then `bunx vitest run src/lib/github src/github`.
Expected: PASS. (The `gh` cases run in CI.)

- [ ] **Step 10: Commit**

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: GitHub Repository type and REST repository and readme routes"
```

---

### Task 9: Labels and assignable users on Repository

**Files:**
- Create: `apps/api/src/github/graphql/types/label.type.ts`
- Modify: `apps/api/src/lib/github/nodes.ts` (`toLabelNode`), `repository.resolver.ts` (`labels`, `label`, `assignableUsers`), `viewer.resolver.ts` (`Label` in `lookup`)
- Modify: `apps/api/test/github-graphql.e2e-spec.ts`

**Interfaces:**
- Produces `LabelNode` (`id name color description isDefault url resourcePath createdAt updatedAt`) with non-GraphQL `ghostId`, `repositoryGhostId`; `LabelConnection`.
- Produces `toLabelNode(label: LabelDTO, repository: { ghostId: string; nameWithOwner: string; url: string }): LabelNode` (`LabelDTO` from `resources/issues/dto/label.dto.ts`).
- Produces `UserConnection` (`Connection(UserNode, 'User')`).

- [ ] **Step 1: Failing e2e case**

```ts
  it('lists labels and assignable users, which gh issue create resolves names against', async () => {
    const api = request(app.getHttpServer());
    await api.post(`/api/repositories/${username}/public-repo/labels`).set('cookie', owner.cookie).send({ name: 'bug', color: 'd73a4a' }).expect(201);
    const response = await graphql(
      'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { labels(first: 100) { totalCount nodes { id name color description } } label(name: "bug") { name } assignableUsers(first: 100) { totalCount nodes { id login name } } } }',
      { owner: username, name: 'public-repo' },
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    const repository = response.body.data.repository;
    expect(repository.labels.nodes).toContainEqual(expect.objectContaining({ name: 'bug', color: 'd73a4a' }));
    expect(repository.labels.nodes[0].id).toMatch(/^LA_/);
    expect(repository.label).toEqual({ name: 'bug' });
    expect(repository.assignableUsers.nodes.map((user: { login: string }) => user.login)).toContain(username);
  });
```

Check the label-create route and body in `resources/issues/labels.controller.ts` first and adjust the path if it differs. Run; Expected: FAIL.

- [ ] **Step 2: Label type and mapper**

`apps/api/src/github/graphql/types/label.type.ts`:

```ts
import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { URI } from '../scalars.js';
import { Node } from './node.interface.js';

@ObjectType('Label', { implements: () => [Node] })
export class LabelNode {
  kind = 'Label';
  ghostId: string;

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  color: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field()
  isDefault: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  createdAt: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  updatedAt: string | null;
}

export const LabelConnection = Connection(LabelNode, 'Label');
```

Append to `nodes.ts`:

```ts
import type { LabelDTO } from '../../resources/issues/dto/label.dto.js';
import { LabelNode } from '../../github/graphql/types/label.type.js';

// Mapper: labels arrive inside IssuesService's issue DTOs, already selected for Ghost's API; selecting them again in GitHub's shape would double the query.
export function toLabelNode(label: LabelDTO, repository: { url: string; resourcePath: string }) {
  const path = `/labels/${encodeURIComponent(label.name)}`;
  return Object.assign(new LabelNode(), {
    ghostId: label.id,
    id: encodeNodeId('Label', label.id),
    name: label.name,
    color: label.color,
    description: label.description,
    isDefault: false,
    url: `${repository.url}${path}`,
    resourcePath: `${repository.resourcePath}${path}`,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
  });
}
```

- [ ] **Step 3: Repository field resolvers**

In `RepositoryResolver` (inject `IssuesService` from `IssuesModule`, which exports it; add `IssuesModule` to `GithubModule.imports`):

```ts
  @ResolveField(() => LabelConnection, { nullable: true })
  async labels(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('query', { nullable: true }) query?: string,
  ) {
    const { labels } = await this.issues.listLabels({ username: repository.ownerLogin, repo: repository.slug, requesterId: viewer?.userId });
    const matching = query ? labels.filter((label) => label.name.toLowerCase().includes(query.toLowerCase())) : labels;
    return sliceConnection(matching.map((label) => toLabelNode(label, repository)), { first });
  }

  @ResolveField(() => LabelNode, { nullable: true })
  async label(@Parent() repository: RepositoryNode, @Args('name') name: string, @Viewer() viewer: GithubViewer | null) {
    const { labels } = await this.issues.listLabels({ username: repository.ownerLogin, repo: repository.slug, requesterId: viewer?.userId });
    const label = labels.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    return label ? toLabelNode(label, repository) : null;
  }

  @ResolveField(() => UserConnection)
  async assignableUsers(
    @Parent() repository: RepositoryNode,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('query', { nullable: true }) query?: string,
  ) {
    const ids = await this.assignableUserIds(repository.ghostId);
    const rows = (await loaders.usersById.loadMany(ids)).filter((row): row is UserRow => !!row && !(row instanceof Error));
    const matching = query ? rows.filter((row) => `${row.username} ${row.name}`.toLowerCase().includes(query.toLowerCase())) : rows;
    return sliceConnection(matching.map((row) => toUserNode(row, githubOrigins(this.config))), { first });
  }
```

Check `listLabels`'s exact parameters and return shape at `issues.service.ts:756` and adapt (`{ labels }` vs an array). `assignableUserIds` must return everyone `setIssueAssignees` accepts. Read `setIssueAssignees` (`issues.service.ts:993`) and `resolveUsers`: if any user may be assigned, `assignableUsers` lists the owner, accepted collaborators, team members with access and organization members. Write `assignableUserIds` as a private query over `repository.ownerId`, `repository_collaborator` (accepted), and `member` for `organizationId`, deduplicated. If `setIssueAssignees` itself restricts to writers, reuse its check instead of writing a second one. Prefer moving the query into `IssuesService` as `listAssignableUserIds(repositoryId)` if it is the rule `setIssueAssignees` applies, so the rule lives once.

`UserConnection` is `Connection(UserNode, 'User')`; export it from `user.type.ts`.

- [ ] **Step 4: `node(id:)` for labels**

In `ViewerResolver.lookup`, a `Label` id loads `select label, repository where label.id = …`, authorizes the repository for the viewer, and maps with `toLabelNode`. Unreadable means `null`.

- [ ] **Step 5: Run, then commit**

Run: `$E2E test/github-graphql.e2e-spec.ts` and the conformance test. Expected: PASS.

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: GitHub labels and assignable users on Repository"
```

---

### Task 10: Issues: `Issue`, `IssueComment`, `issues`, `issue`, `issueOrPullRequest`, placeholders

**Files:**
- Create: `apps/api/src/github/graphql/types/issue.type.ts`, `issue-comment.type.ts`, `pull-request.type.ts`, `placeholders.type.ts`
- Create: `apps/api/src/github/graphql/resolvers/issue.resolver.ts`, `issue-comment.resolver.ts`
- Modify: `enums.ts`, `nodes.ts`, `repository.resolver.ts`, `viewer.resolver.ts`, `github.module.ts`
- Modify: tests

**Interfaces:**
- Produces `IssueNode` with non-GraphQL `ghostId`, `ownerLogin`, `repoSlug`, `repositoryGhostId`, `authorLogin`, `assigneeLogins: string[]`, `labelDtos: LabelDTO[]`, `repositoryUrl`, `repositoryResourcePath`.
- Produces `toIssueNode(issue: IssueDTO, repository: RepositoryNode): IssueNode`, `toPullRequestNode(issue: IssueDTO, repository: RepositoryNode): PullRequestNode`, `toIssueCommentNode(comment: CommentRow, issue: IssueNode): IssueCommentNode`.
- Produces `IssueResolver.fromRepository(repository: RepositoryNode, number: number, requesterId?: string): Promise<IssueNode | PullRequestNode>` used by Task 12.
- Produces union `IssueOrPullRequest`, enums `IssueState`, `IssueStateReason`, `IssueOrderField`, `OrderDirection`, `CommentAuthorAssociation`, `ReactionContent`, `PullRequestState`, input `IssueOrder`, input `IssueFilters`.

- [ ] **Step 1: Failing e2e cases**

```ts
  it('lists, filters and pages issues as gh issue list asks', async () => {
    const api = request(app.getHttpServer());
    for (const title of ['First', 'Second', 'Third']) {
      await api.post(`/api/repositories/${username}/public-repo/issues`).set('cookie', owner.cookie).send({ title, labels: title === 'Second' ? ['bug'] : [] }).expect(201);
    }
    const LIST = 'query($owner: String!, $repo: String!, $limit: Int, $endCursor: String, $states: [IssueState!] = OPEN, $assignee: String, $author: String) { repository(owner: $owner, name: $repo) { hasIssuesEnabled issues(first: $limit, after: $endCursor, orderBy: {field: CREATED_AT, direction: DESC}, states: $states, filterBy: {assignee: $assignee, createdBy: $author}) { totalCount nodes { number title url state updatedAt labels(first: 100) { nodes { id name description color } totalCount } } pageInfo { hasNextPage endCursor } } } }';
    const first = await graphql(LIST, { owner: username, repo: 'public-repo', limit: 2 }, owner.key).expect(200);
    expect(first.body.errors).toBeUndefined();
    const issues = first.body.data.repository.issues;
    expect(issues.totalCount).toBe(3);
    expect(issues.nodes.map((issue: { title: string }) => issue.title)).toEqual(['Third', 'Second']);
    expect(issues.nodes[1].labels.nodes[0].name).toBe('bug');
    expect(issues.nodes[0].state).toBe('OPEN');
    expect(issues.pageInfo.hasNextPage).toBe(true);
    const second = await graphql(LIST, { owner: username, repo: 'public-repo', limit: 2, endCursor: issues.pageInfo.endCursor }, owner.key).expect(200);
    expect(second.body.data.repository.issues.nodes.map((issue: { title: string }) => issue.title)).toEqual(['First']);
  });

  it('answers every field gh issue view asks for, with empty values for what Ghost lacks', async () => {
    const api = request(app.getHttpServer());
    const created = await api.post(`/api/repositories/${username}/public-repo/issues`).set('cookie', owner.cookie).send({ title: 'Viewed', body: 'Body text' }).expect(201);
    await api.post(`/api/repositories/${username}/public-repo/issues/${created.body.number}/comments`).set('cookie', owner.cookie).send({ body: 'A comment' }).expect(201);
    const VIEW = `query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { hasIssuesEnabled issue: issueOrPullRequest(number: $number) { __typename ...on Issue { id number url state stateReason createdAt title body author { login ...on User { id name } } milestone { number title description dueOn } assignees(first: 100) { nodes { id login name databaseId } totalCount } labels(first: 100) { nodes { id name description color } totalCount } reactionGroups { content users { totalCount } } comments(last: 1) { nodes { author { login ...on User { id name } } authorAssociation body createdAt includesCreatedEdit isMinimized minimizedReason reactionGroups { content users { totalCount } } } totalCount } issueType { id name description color } parent { id number title url state repository { nameWithOwner } } subIssues(first: 100) { nodes { id number } totalCount } subIssuesSummary { total completed percentCompleted } } } } }`;
    const response = await graphql(VIEW, { owner: username, repo: 'public-repo', number: created.body.number }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository.issue).toMatchObject({
      __typename: 'Issue',
      title: 'Viewed',
      body: 'Body text',
      state: 'OPEN',
      stateReason: null,
      author: { login: username },
      milestone: null,
      reactionGroups: [],
      issueType: null,
      parent: null,
      subIssues: { nodes: [], totalCount: 0 },
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      comments: { totalCount: 1, nodes: [{ body: 'A comment', authorAssociation: 'OWNER', isMinimized: false }] },
    });
  });

  it('answers a pull request number in issueOrPullRequest as a PullRequest', async () => {
    // Ghost numbers pull requests and issues together; create a pull request through Ghost's API in beforeAll for this case, or insert an issue row with isPullRequest true through the database the harness exposes.
    const response = await graphql('query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { issueOrPullRequest(number: $number) { __typename ...on PullRequest { number title } } } }', { owner: username, repo: 'public-repo', number: pullRequestNumber }, owner.key).expect(200);
    expect(response.body.data.repository.issueOrPullRequest).toMatchObject({ __typename: 'PullRequest', number: pullRequestNumber });
  });

  it('answers a missing issue number as NOT_FOUND', async () => {
    const response = await graphql('query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { issue(number: 9999) { title } } }', { owner: username, repo: 'public-repo' }, owner.key).expect(200);
    expect(response.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: `Could not resolve to an Issue with the number of 9999.` });
  });
```

For `pullRequestNumber`, follow how `test/pull-request-reviews.e2e-spec.ts` opens a pull request (push a branch, `POST /api/repositories/:u/:r/pulls`) and copy its setup into this file's `beforeAll`. Run; Expected: FAIL.

- [ ] **Step 2: Enums**

Append to `enums.ts`:

```ts
export enum IssueState { OPEN = 'OPEN', CLOSED = 'CLOSED' }
registerEnumType(IssueState, { name: 'IssueState' });

export enum IssueStateReason { COMPLETED = 'COMPLETED', NOT_PLANNED = 'NOT_PLANNED', REOPENED = 'REOPENED', DUPLICATE = 'DUPLICATE' }
registerEnumType(IssueStateReason, { name: 'IssueStateReason' });

export enum PullRequestState { OPEN = 'OPEN', CLOSED = 'CLOSED', MERGED = 'MERGED' }
registerEnumType(PullRequestState, { name: 'PullRequestState' });

export enum IssueOrderField { CREATED_AT = 'CREATED_AT', UPDATED_AT = 'UPDATED_AT', COMMENTS = 'COMMENTS' }
registerEnumType(IssueOrderField, { name: 'IssueOrderField' });

export enum OrderDirection { ASC = 'ASC', DESC = 'DESC' }
registerEnumType(OrderDirection, { name: 'OrderDirection' });

export enum CommentAuthorAssociation { OWNER = 'OWNER', MEMBER = 'MEMBER', COLLABORATOR = 'COLLABORATOR', CONTRIBUTOR = 'CONTRIBUTOR', FIRST_TIMER = 'FIRST_TIMER', FIRST_TIME_CONTRIBUTOR = 'FIRST_TIME_CONTRIBUTOR', MANNEQUIN = 'MANNEQUIN', NONE = 'NONE' }
registerEnumType(CommentAuthorAssociation, { name: 'CommentAuthorAssociation' });

export enum ReactionContent { THUMBS_UP = 'THUMBS_UP', THUMBS_DOWN = 'THUMBS_DOWN', LAUGH = 'LAUGH', HOORAY = 'HOORAY', CONFUSED = 'CONFUSED', HEART = 'HEART', ROCKET = 'ROCKET', EYES = 'EYES' }
registerEnumType(ReactionContent, { name: 'ReactionContent' });

export enum ReportedContentClassifiers { SPAM = 'SPAM', ABUSE = 'ABUSE', OFF_TOPIC = 'OFF_TOPIC', OUTDATED = 'OUTDATED', DUPLICATE = 'DUPLICATE', RESOLVED = 'RESOLVED' }
registerEnumType(ReportedContentClassifiers, { name: 'ReportedContentClassifiers' });
```

- [ ] **Step 3: Placeholder types for what Ghost lacks**

`apps/api/src/github/graphql/types/placeholders.type.ts`:

```ts
import { Field, Float, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { ReactionContent } from '../enums.js';

/** Ghost has no milestones, reactions, issue types or sub-issues. These types exist so gh's fixed queries validate; resolvers answer them empty. */

@ObjectType('Milestone')
export class MilestoneNode {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  dueOn: Date | null;
}

@ObjectType('ReactorConnection')
export class ReactorConnection {
  @Field(() => Int)
  totalCount: number;
}

@ObjectType('ReactionGroup')
export class ReactionGroup {
  @Field(() => ReactionContent)
  content: ReactionContent;

  @Field(() => ReactorConnection)
  users: ReactorConnection;
}

@ObjectType('IssueType')
export class IssueTypeNode {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field()
  color: string;
}

@ObjectType('SubIssuesSummary')
export class SubIssuesSummary {
  @Field(() => Int)
  total: number;

  @Field(() => Int)
  completed: number;

  @Field(() => Int)
  percentCompleted: number;
}
```

If the conformance test reports a different type for `ReactionGroup.users` (GitHub has `ReactingUserConnection` with `totalCount`), rename the class's GraphQL name to match; the test names the exact GitHub type. Same for `IssueType.color` (an enum `IssueTypeColor` on GitHub): if flagged, declare the enum with GitHub's values and type the field with it. Remove the unused `Float` import.

- [ ] **Step 4: Issue, PullRequest, IssueComment types**

`apps/api/src/github/graphql/types/issue.type.ts`:

```ts
import { createUnionType, Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { Connection } from '../connection.js';
import { IssueState, IssueStateReason } from '../enums.js';
import { HTML, URI } from '../scalars.js';
import { Node, UniformResourceLocatable } from './node.interface.js';
import { PullRequestNode } from './pull-request.type.js';

@ObjectType('Issue', { implements: () => [Node, UniformResourceLocatable] })
export class IssueNode {
  kind = 'Issue';
  ghostId: string;
  ownerLogin: string;
  repoSlug: string;
  repositoryGhostId: string;
  authorLogin: string;
  assigneeLogins: string[];
  labelDtos: LabelDTO[];
  repositoryUrl: string;
  repositoryResourcePath: string;

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field(() => HTML)
  bodyHTML: string;

  @Field()
  bodyText: string;

  @Field(() => IssueState)
  state: IssueState;

  @Field(() => IssueStateReason, { nullable: true })
  stateReason: IssueStateReason | null;

  @Field()
  closed: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  closedAt: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt: string;

  @Field(() => GraphQLISODateTime)
  updatedAt: string;

  @Field()
  isPinned: boolean;

  @Field()
  locked: boolean;

  @Field()
  includesCreatedEdit: boolean;

  @Field()
  viewerCanUpdate: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const IssueConnection = Connection(IssueNode, 'Issue');

export const IssueOrPullRequest = createUnionType({
  name: 'IssueOrPullRequest',
  types: () => [IssueNode, PullRequestNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});
```

`bodyHTML` answers the raw markdown escaped as text inside `<p>`; `gh` reads `body`. If conformance flags `isPinned` as nullable on GitHub, follow it.

`apps/api/src/github/graphql/types/pull-request.type.ts`:

```ts
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { PullRequestState } from '../enums.js';
import { URI } from '../scalars.js';
import { Node, UniformResourceLocatable } from './node.interface.js';

/** Identity only, so issueOrPullRequest can answer a pull request's number; the full type arrives with milestone 3. */
@ObjectType('PullRequest', { implements: () => [Node, UniformResourceLocatable] })
export class PullRequestNode {
  kind = 'PullRequest';

  @Field(() => ID)
  id: string;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field(() => PullRequestState)
  state: PullRequestState;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}
```

`apps/api/src/github/graphql/types/issue-comment.type.ts`:

```ts
import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { CommentAuthorAssociation } from '../enums.js';
import { URI } from '../scalars.js';
import { Node, UniformResourceLocatable } from './node.interface.js';

@ObjectType('IssueComment', { implements: () => [Node, UniformResourceLocatable] })
export class IssueCommentNode {
  kind = 'IssueComment';
  ghostId: string;
  authorLogin: string;

  @Field(() => ID)
  id: string;

  @Field()
  body: string;

  @Field(() => GraphQLISODateTime)
  createdAt: string;

  @Field(() => GraphQLISODateTime)
  updatedAt: string;

  @Field()
  includesCreatedEdit: boolean;

  @Field()
  isMinimized: boolean;

  @Field(() => String, { nullable: true })
  minimizedReason: string | null;

  @Field(() => CommentAuthorAssociation)
  authorAssociation: CommentAuthorAssociation;

  @Field()
  viewerDidAuthor: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const IssueCommentConnection = Connection(IssueCommentNode, 'IssueComment');
```

- [ ] **Step 5: Mappers with a unit test**

Append to `nodes.spec.ts`:

```ts
import { IssueState } from '../../github/graphql/enums.js';
import { toIssueNode } from './nodes.js';

describe('toIssueNode', () => {
  const repository = { ghostId: 'repo_1', ownerLogin: 'ada', slug: 'tools', url: 'https://ghost.test/ada/tools', resourcePath: '/ada/tools' } as never;
  const dto = { id: 'issue_1', number: 7, title: 'T', body: null, state: 'closed', isPullRequest: false, authorUsername: 'ada', closedByUsername: 'ada', labels: [], assignees: ['bob'], commentCount: 0, closedAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', viewerCanEdit: true };

  it('maps Ghost issue state, empty body and URLs onto GitHub fields', () => {
    const node = toIssueNode(dto as never, repository);
    expect(node).toMatchObject({ number: 7, body: '', state: IssueState.CLOSED, closed: true, stateReason: 'COMPLETED', url: 'https://ghost.test/ada/tools/issues/7', resourcePath: '/ada/tools/issues/7', assigneeLogins: ['bob'], viewerCanUpdate: true });
    expect(node.id).toMatch(/^I_/);
  });

  it('leaves stateReason null on an open issue', () => {
    expect(toIssueNode({ ...dto, state: 'open', closedAt: null } as never, repository).stateReason).toBeNull();
  });
});
```

Append to `nodes.ts`:

```ts
import type { IssueDTO } from '../../resources/issues/dto/issue.dto.js';
import { IssueState, IssueStateReason, PullRequestState, CommentAuthorAssociation } from '../../github/graphql/enums.js';
import { IssueNode } from '../../github/graphql/types/issue.type.js';
import { PullRequestNode } from '../../github/graphql/types/pull-request.type.js';
import { IssueCommentNode } from '../../github/graphql/types/issue-comment.type.js';
import type { RepositoryNode } from '../../github/graphql/types/repository.type.js';

type RepositoryRefs = Pick<RepositoryNode, 'ghostId' | 'ownerLogin' | 'slug' | 'url' | 'resourcePath'>;

// Mapper: IssuesService.getIssues/getIssue already expand authors, labels and assignees for Ghost's API; the GitHub shape renames and re-cases those fields.
export function toIssueNode(issue: IssueDTO, repository: RepositoryRefs) {
  const path = `${repository.resourcePath}/issues/${issue.number}`;
  const closed = issue.state === 'closed';
  return Object.assign(new IssueNode(), {
    ghostId: issue.id,
    ownerLogin: repository.ownerLogin,
    repoSlug: repository.slug,
    repositoryGhostId: repository.ghostId,
    authorLogin: issue.authorUsername,
    assigneeLogins: issue.assignees,
    labelDtos: issue.labels,
    repositoryUrl: repository.url,
    repositoryResourcePath: repository.resourcePath,
    id: encodeNodeId('Issue', issue.id),
    databaseId: null,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    bodyHTML: '',
    bodyText: issue.body ?? '',
    state: closed ? IssueState.CLOSED : IssueState.OPEN,
    // ponytail: Ghost records no close reason; every close reads as COMPLETED until it does.
    stateReason: closed ? IssueStateReason.COMPLETED : null,
    closed,
    closedAt: issue.closedAt,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    isPinned: false,
    locked: false,
    includesCreatedEdit: issue.updatedAt !== issue.createdAt,
    viewerCanUpdate: issue.viewerCanEdit,
    url: `${repository.url}/issues/${issue.number}`,
    resourcePath: path,
  });
}

// Mapper: same source as toIssueNode; a number that belongs to a pull request answers as one.
export function toPullRequestNode(issue: IssueDTO, repository: RepositoryRefs) {
  return Object.assign(new PullRequestNode(), {
    id: encodeNodeId('PullRequest', issue.id),
    number: issue.number,
    title: issue.title,
    // ponytail: merged requests read as CLOSED until milestone 3 reads pull_request.state.
    state: issue.state === 'closed' ? PullRequestState.CLOSED : PullRequestState.OPEN,
    url: `${repository.url}/pull/${issue.number}`,
    resourcePath: `${repository.resourcePath}/pull/${issue.number}`,
  });
}

export type CommentRow = { id: string; body: string; createdAt: string; updatedAt: string; authorUsername: string };

// Mapper: IssuesService.getComments selects Ghost's comment columns for its own API.
export function toIssueCommentNode(comment: CommentRow, issue: IssueNode, viewerLogin: string | null) {
  return Object.assign(new IssueCommentNode(), {
    ghostId: comment.id,
    authorLogin: comment.authorUsername,
    id: encodeNodeId('IssueComment', comment.id),
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    includesCreatedEdit: comment.updatedAt !== comment.createdAt,
    isMinimized: false,
    minimizedReason: null,
    // ponytail: OWNER or NONE only; MEMBER and COLLABORATOR need a role lookup per author.
    authorAssociation: comment.authorUsername === issue.ownerLogin ? CommentAuthorAssociation.OWNER : CommentAuthorAssociation.NONE,
    viewerDidAuthor: comment.authorUsername === viewerLogin,
    url: `${issue.url}#issuecomment-${comment.id}`,
    resourcePath: `${issue.resourcePath}#issuecomment-${comment.id}`,
  });
}
```

Use `comment.updatedAt !== comment.createdAt`, accepting that ISO strings from the same `now()` compare equal. Run `bunx vitest run src/lib/github/nodes.spec.ts`; Expected: PASS.

- [ ] **Step 6: Inputs for `issues(...)`**

Append to `enums.ts` (or a new `inputs.ts` beside it):

```ts
import { Field, InputType } from '@nestjs/graphql';

@InputType('IssueOrder')
export class IssueOrder {
  @Field(() => IssueOrderField)
  field: IssueOrderField;

  @Field(() => OrderDirection)
  direction: OrderDirection;
}

@InputType('IssueFilters')
export class IssueFilters {
  @Field(() => String, { nullable: true })
  assignee?: string | null;

  @Field(() => String, { nullable: true })
  createdBy?: string | null;

  @Field(() => String, { nullable: true })
  mentioned?: string | null;

  @Field(() => [String], { nullable: true })
  labels?: string[] | null;

  @Field(() => [IssueState], { nullable: true })
  states?: IssueState[] | null;
}
```

`mentioned` is accepted and ignored (Ghost has no mention index); add `// ponytail: mentioned is accepted and ignored; filter on issue_reference mentions when Ghost records them.` beside it.

- [ ] **Step 7: Repository issue fields and the issue resolver**

Add to `RepositoryResolver`:

```ts
  @ResolveField(() => IssueConnection)
  async issues(
    @Parent() repository: RepositoryNode,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('after', { nullable: true }) after?: string,
    @Args('states', { type: () => [IssueState], nullable: true }) states?: IssueState[],
    @Args('labels', { type: () => [String], nullable: true }) labels?: string[],
    @Args('orderBy', { type: () => IssueOrder, nullable: true }) orderBy?: IssueOrder,
    @Args('filterBy', { type: () => IssueFilters, nullable: true }) filterBy?: IssueFilters,
  ) {
    const wanted = states ?? filterBy?.states ?? [];
    const state = wanted.length === 1 ? (wanted[0] === IssueState.OPEN ? 'open' : 'closed') : 'all';
    const sort = orderBy?.field === IssueOrderField.UPDATED_AT ? 'updated' : orderBy?.field === IssueOrderField.COMMENTS ? 'comments' : 'created';
    const page = await this.issues.getIssues({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
      query: {
        state,
        sort,
        direction: orderBy?.direction === OrderDirection.ASC ? 'asc' : 'desc',
        cursor: after,
        limit: first ?? 30,
        assignee: filterBy?.assignee ?? undefined,
        author: filterBy?.createdBy ?? undefined,
        labels: (labels ?? filterBy?.labels)?.join(','),
      },
    });
    return {
      nodes: page.issues.map((issue) => toIssueNode(issue, repository)),
      totalCount: state === 'open' ? page.openCount : state === 'closed' ? page.closedCount : page.total,
      pageInfo: { hasNextPage: page.hasMore, hasPreviousPage: !!after, startCursor: null, endCursor: page.nextCursor },
    };
  }

  @ResolveField(() => IssueNode, { nullable: true })
  async issue(@Parent() repository: RepositoryNode, @Args('number', { type: () => Int }) number: number, @Viewer() viewer: GithubViewer | null) {
    const found = await this.issueNodes.fromRepository(repository, number, viewer?.userId);
    if (found instanceof PullRequestNode) throw new CouldNotResolveError(`Could not resolve to an Issue with the number of ${number}.`);
    return found;
  }

  @ResolveField(() => IssueOrPullRequest, { nullable: true })
  issueOrPullRequest(@Parent() repository: RepositoryNode, @Args('number', { type: () => Int }) number: number, @Viewer() viewer: GithubViewer | null) {
    return this.issueNodes.fromRepository(repository, number, viewer?.userId);
  }
```

`getIssues` caps `limit`; check the `@Max` on `GetIssuesQueryDTO.limit` and clamp `first` to it (gh asks for up to 100). The service's `limit` check runs only through the controller's ValidationPipe, so clamp here: `limit: Math.min(first ?? 30, 100)`. `getIssues` excludes pull requests, as GitHub's `issues` does.

`apps/api/src/github/graphql/resolvers/issue.resolver.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { Args, Context, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { CouldNotResolveError } from '../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../lib/github/loaders.js';
import { toIssueCommentNode, toIssueNode, toLabelNode, toPullRequestNode, toUserNode, type UserRow } from '../../../lib/github/nodes.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { IssueNotFoundError } from '../../../lib/issues/issues.errors.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { sliceConnection } from '../connection.js';
import { IssueCommentConnection } from '../types/issue-comment.type.js';
import { IssueNode } from '../types/issue.type.js';
import { LabelConnection } from '../types/label.type.js';
import { Actor } from '../types/node.interface.js';
import { IssueTypeNode, MilestoneNode, ReactionGroup, SubIssuesSummary } from '../types/placeholders.type.js';
import { RepositoryNode } from '../types/repository.type.js';
import { IssueConnection } from '../types/issue.type.js';
import { UserConnection } from '../types/user.type.js';
import { RepositoryResolver } from './repository.resolver.js';

@Resolver(() => IssueNode)
@AllowAnonymous()
export class IssueResolver {
  constructor(
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryResolver,
    private readonly config: ConfigService,
  ) {}

  async fromRepository(repository: RepositoryNode, number: number, requesterId?: string) {
    try {
      const issue = await this.issues.getIssue({ username: repository.ownerLogin, repo: repository.slug, number, requesterId });
      return issue.isPullRequest ? toPullRequestNode(issue, repository) : toIssueNode(issue, repository);
    } catch (error) {
      if (error instanceof IssueNotFoundError) throw new CouldNotResolveError(`Could not resolve to an issue or pull request with the number of ${number}.`);
      throw error;
    }
  }

  @ResolveField(() => Actor, { nullable: true })
  async author(@Parent() issue: IssueNode, @Context() { loaders }: GraphqlContext) {
    const row = await loaders.usersByLogin.load(issue.authorLogin);
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  @ResolveField(() => UserConnection)
  async assignees(@Parent() issue: IssueNode, @Context() { loaders }: GraphqlContext, @Args('first', { type: () => Int, nullable: true }) first?: number) {
    const rows = (await loaders.usersByLogin.loadMany(issue.assigneeLogins)).filter((row): row is UserRow => !!row && !(row instanceof Error));
    return sliceConnection(rows.map((row) => toUserNode(row, githubOrigins(this.config))), { first });
  }

  @ResolveField(() => LabelConnection, { nullable: true })
  labels(@Parent() issue: IssueNode, @Args('first', { type: () => Int, nullable: true }) first?: number) {
    const repository = { url: issue.repositoryUrl, resourcePath: issue.repositoryResourcePath };
    return sliceConnection(issue.labelDtos.map((label) => toLabelNode(label, repository)), { first });
  }

  @ResolveField(() => IssueCommentConnection)
  async comments(
    @Parent() issue: IssueNode,
    @Viewer() viewer: GithubViewer | null,
    @Context() { loaders }: GraphqlContext,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('last', { type: () => Int, nullable: true }) last?: number,
  ) {
    const { comments } = await this.issues.getComments({ username: issue.ownerLogin, repo: issue.repoSlug, number: issue.number, requesterId: viewer?.userId });
    const viewerLogin = viewer ? ((await loaders.usersById.load(viewer.userId))?.username ?? null) : null;
    return sliceConnection(comments.map((comment) => toIssueCommentNode(comment, issue, viewerLogin)), { first, last });
  }

  @ResolveField(() => RepositoryNode)
  repository(@Parent() issue: IssueNode, @Viewer() viewer: GithubViewer | null) {
    return this.repositories.load(issue.repositoryGhostId, viewer?.userId);
  }

  @ResolveField(() => MilestoneNode, { nullable: true })
  milestone() {
    return null;
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }

  @ResolveField(() => IssueTypeNode, { nullable: true })
  issueType() {
    return null;
  }

  @ResolveField(() => IssueNode, { nullable: true })
  parent() {
    return null;
  }

  @ResolveField(() => IssueConnection)
  subIssues() {
    return sliceConnection([], {});
  }

  @ResolveField(() => SubIssuesSummary)
  subIssuesSummary() {
    return { total: 0, completed: 0, percentCompleted: 0 };
  }
}
```

Add the same `milestone`, `reactionGroups` style empty resolvers to an `IssueCommentResolver` in `issue-comment.resolver.ts` (`author` via `usersByLogin`, `reactionGroups` → `[]`).

GitHub's `IssueOrPullRequest` lookup message reads "Could not resolve to an issue or pull request with the number of 9999." — keep both wordings exactly as written above; `issue(number:)` uses "an Issue", `issueOrPullRequest` "an issue or pull request". The e2e case in Step 1 uses `issue(number:)`.

The `author` field is declared on the `Comment` interface on GitHub, `Actor` nullable. `Actor` resolves via `kind` on `UserNode`.

Register in `GithubModule`: `IssueResolver`, `IssueCommentResolver`, and `IssuesModule` in `imports`. `RepositoryResolver` injects `IssueResolver` as `issueNodes` and `IssueResolver` injects `RepositoryResolver`: a cycle. Break it with `@Inject(forwardRef(() => IssueResolver))` on the `RepositoryResolver` side.

- [ ] **Step 8: `node(id:)` for issues and comments**

`ViewerResolver.lookup`: an `Issue` or `PullRequest` id selects `issue.repositoryId, issue.number` by id, loads the repository node with `repositories.load`, then `issueNodes.fromRepository`. An `IssueComment` id selects the comment's issue the same way and finds the comment in `getComments`. Every failure resolves to `null`.

Extract the id-to-ref queries into `apps/api/src/lib/github/node-lookup.ts`:

```ts
import { type Database, schema } from '@ghost/db';
import { eq } from 'drizzle-orm';

/** The repository and number behind an issue's Ghost id, or null. */
export async function issueRefOf(db: Database, issueId: string) {
  const [row] = await db.select({ repositoryId: schema.issue.repositoryId, number: schema.issue.number }).from(schema.issue).where(eq(schema.issue.id, issueId));
  return row ?? null;
}

/** The issue a comment belongs to, or null. */
export async function commentIssueOf(db: Database, commentId: string) {
  const [row] = await db.select({ issueId: schema.issueComment.issueId }).from(schema.issueComment).where(eq(schema.issueComment.id, commentId));
  return row ?? null;
}

/** Label names for label ids within one repository, in the order given; ids from another repository are dropped. */
export async function labelNamesOf(db: Database, repositoryId: string, labelIds: string[]) {
  const rows = await db.select({ id: schema.label.id, name: schema.label.name, repositoryId: schema.label.repositoryId }).from(schema.label);
  const byId = new Map(rows.filter((row) => row.repositoryId === repositoryId).map((row) => [row.id, row.name]));
  return labelIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Usernames for user ids, in the order given; unknown ids are dropped. */
export async function usernamesOf(db: Database, userIds: string[]) {
  const rows = await db.select({ id: schema.user.id, username: schema.user.username }).from(schema.user);
  const byId = new Map(rows.map((row) => [row.id, row.username]));
  return userIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
}
```

Filter in SQL, not in memory: `labelNamesOf` must use `where(and(eq(schema.label.repositoryId, repositoryId), inArray(schema.label.id, labelIds)))` and `usernamesOf` `where(inArray(schema.user.id, userIds))`, each returning early with `[]` for an empty input. The sketch above shows the ordering logic; write the query with the `where` clauses.

- [ ] **Step 9: `gh issue list` and `gh issue view` cases**

Add to `test/gh-cli.e2e-spec.ts` (create two issues and one comment through Ghost's API in `beforeAll`):

```ts
  it('lists issues', async () => {
    const out = await ok(['issue', 'list', '-R', `${GH_E2E_HOST}/${username}/tools`, '--json', 'number,title,state,labels,author,url']);
    const issues = JSON.parse(out);
    expect(issues.map((issue: { title: string }) => issue.title)).toEqual(expect.arrayContaining(['Broken build', 'Docs typo']));
    expect(issues[0].state).toBe('OPEN');
  });

  it('views an issue with comments', async () => {
    const out = await ok(['issue', 'view', '1', '-R', `${GH_E2E_HOST}/${username}/tools`, '--comments']);
    expect(out).toContain('Broken build');
    expect(out).toContain('Seen it too');
  });

  it('filters issues by state, label, author and assignee', async () => {
    const out = await ok(['issue', 'list', '-R', `${GH_E2E_HOST}/${username}/tools`, '--state', 'all', '--author', username, '--json', 'number']);
    expect(JSON.parse(out).length).toBeGreaterThanOrEqual(2);
  });
```

- [ ] **Step 10: Run, then commit**

Run: `$E2E test/github-graphql.e2e-spec.ts`, `bunx vitest run src/lib/github src/github`. Expected: PASS.

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: GitHub Issue, IssueComment and issueOrPullRequest, with empty milestones, reactions and sub-issues"
```

---

### Task 11: `search(type: ISSUE)`

**Files:**
- Create: `apps/api/src/lib/github/issue-search.ts`, `issue-search.spec.ts`
- Create: `apps/api/src/github/graphql/types/search.type.ts`, `apps/api/src/github/graphql/resolvers/search.resolver.ts`
- Modify: `enums.ts` (`SearchType`), `github.module.ts`, tests

**Interfaces:**
- Produces `parseIssueSearch(query: string): { repo: { owner: string; name: string } | null; state: 'open' | 'closed' | 'all'; isPullRequest: boolean | null; author?: string; assignee?: string; labels: string[]; text: string }`.
- Produces `SearchResultItemConnection { issueCount: Int!, nodes: [SearchResultItem], pageInfo: PageInfo! }` and union `SearchResultItem = Issue | PullRequest | Repository | User | Organization` (only Issue and PullRequest are returned in milestone 1).

- [ ] **Step 1: Failing unit test**

```ts
import { describe, expect, it } from 'vitest';

import { parseIssueSearch } from './issue-search.js';

describe('parseIssueSearch', () => {
  it('reads the qualifiers gh writes for issue list --search', () => {
    expect(parseIssueSearch('repo:ada/tools is:issue is:open label:bug label:"help wanted" author:ada assignee:bob crash on start')).toEqual({
      repo: { owner: 'ada', name: 'tools' },
      state: 'open',
      isPullRequest: false,
      author: 'ada',
      assignee: 'bob',
      labels: ['bug', 'help wanted'],
      text: 'crash on start',
    });
  });

  it('ignores qualifiers Ghost cannot filter on instead of failing', () => {
    expect(parseIssueSearch('repo:ada/tools milestone:v1 reason:completed sort:created-desc type:issue state:closed fix')).toMatchObject({
      state: 'closed',
      isPullRequest: false,
      labels: [],
      text: 'fix',
    });
  });

  it('defaults to every state and both kinds', () => {
    expect(parseIssueSearch('repo:ada/tools')).toMatchObject({ state: 'all', isPullRequest: null, text: '' });
  });
});
```

Run: `bunx vitest run src/lib/github/issue-search.spec.ts` — Expected: FAIL.

- [ ] **Step 2: Parser**

```ts
const TOKEN = /(-?[\w-]+):("[^"]*"|\S+)|("[^"]*"|\S+)/g;

/** GitHub's issue search syntax, as far as Ghost's issue filters reach. Qualifiers Ghost cannot apply are dropped, as GitHub drops unknown ones. */
export function parseIssueSearch(query: string) {
  const result = {
    repo: null as { owner: string; name: string } | null,
    state: 'all' as 'open' | 'closed' | 'all',
    isPullRequest: null as boolean | null,
    author: undefined as string | undefined,
    assignee: undefined as string | undefined,
    labels: [] as string[],
    text: '',
  };
  const words: string[] = [];
  for (const [, key, rawValue, bare] of query.matchAll(TOKEN)) {
    if (bare) {
      words.push(bare.replace(/^"|"$/g, ''));
      continue;
    }
    const value = rawValue!.replace(/^"|"$/g, '');
    switch (key) {
      case 'repo': {
        const [owner, name] = value.split('/');
        if (owner && name) result.repo = { owner, name };
        break;
      }
      case 'is':
        if (value === 'open' || value === 'closed') result.state = value;
        if (value === 'issue') result.isPullRequest = false;
        if (value === 'pr') result.isPullRequest = true;
        break;
      case 'state':
        if (value === 'open' || value === 'closed') result.state = value;
        break;
      case 'type':
        if (value === 'issue') result.isPullRequest = false;
        if (value === 'pr') result.isPullRequest = true;
        break;
      case 'author':
        result.author = value;
        break;
      case 'assignee':
        result.assignee = value;
        break;
      case 'label':
        result.labels.push(value);
        break;
    }
  }
  result.text = words.join(' ');
  return result;
}
```

Run the unit test; Expected: PASS.

- [ ] **Step 3: Types and resolver**

`search.type.ts`:

```ts
import { createUnionType, Field, Int, ObjectType } from '@nestjs/graphql';

import { PageInfo } from '../connection.js';
import { IssueNode } from './issue.type.js';
import { PullRequestNode } from './pull-request.type.js';

export const SearchResultItem = createUnionType({
  name: 'SearchResultItem',
  types: () => [IssueNode, PullRequestNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});

@ObjectType('SearchResultItemConnection')
export class SearchResultItemConnection {
  @Field(() => Int)
  issueCount: number;

  @Field(() => [SearchResultItem], { nullable: 'itemsAndList' })
  nodes: Array<IssueNode | PullRequestNode>;

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}
```

Append `SearchType` to `enums.ts` with GitHub's values `ISSUE`, `REPOSITORY`, `USER`, `DISCUSSION` (registered as `SearchType`). Only `ISSUE` is served; the rest answer an empty connection.

`search.resolver.ts`:

```ts
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { parseIssueSearch } from '../../../lib/github/issue-search.js';
import { toIssueNode } from '../../../lib/github/nodes.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { SearchType } from '../enums.js';
import { SearchResultItemConnection } from '../types/search.type.js';
import { RepositoryResolver } from './repository.resolver.js';

const EMPTY = { issueCount: 0, nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } };

@Resolver()
@AllowAnonymous()
export class SearchResolver {
  constructor(
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryResolver,
  ) {}

  @Query(() => SearchResultItemConnection)
  async search(
    @Args('type', { type: () => SearchType }) type: SearchType,
    @Args('query') query: string,
    @Viewer() viewer: GithubViewer | null,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    // gh asks with `last: $limit`; search results have no "end" to count back from, so last reads as first.
    @Args('last', { type: () => Int, nullable: true }) last?: number,
    @Args('after', { nullable: true }) after?: string,
  ) {
    const search = parseIssueSearch(query);
    // ponytail: only repository-scoped issue search; global search across repositories needs its own query over every readable repository.
    if (type !== SearchType.ISSUE || !search.repo || search.isPullRequest === true) return EMPTY;
    const repository = await this.repositories.repository(search.repo.owner, search.repo.name, viewer);
    const page = await this.issues.getIssues({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: viewer?.userId,
      query: { state: search.state, author: search.author, assignee: search.assignee, labels: search.labels.join(',') || undefined, q: search.text || undefined, cursor: after, limit: Math.min(first ?? last ?? 30, 100) },
    });
    return {
      issueCount: search.state === 'open' ? page.openCount : search.state === 'closed' ? page.closedCount : page.total,
      nodes: page.issues.map((issue) => toIssueNode(issue, repository)),
      pageInfo: { hasNextPage: page.hasMore, hasPreviousPage: !!after, startCursor: null, endCursor: page.nextCursor },
    };
  }
}
```

Register `SearchResolver` in `GithubModule`.

- [ ] **Step 4: E2E and `gh` cases**

`test/github-graphql.e2e-spec.ts`:

```ts
  it('searches issues with gh qualifiers and ignores ones Ghost cannot apply', async () => {
    const response = await graphql(
      'query($q: String!) { search(type: ISSUE, last: 30, query: $q) { issueCount nodes { ...on Issue { title } } } }',
      { q: `repo:${username}/public-repo is:issue is:open label:bug milestone:v1 sort:created-desc` },
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.search.nodes).toEqual([{ title: 'Second' }]);
  });
```

`test/gh-cli.e2e-spec.ts`:

```ts
  it('searches issues', async () => {
    const out = await ok(['issue', 'list', '-R', `${GH_E2E_HOST}/${username}/tools`, '--search', 'build', '--json', 'title']);
    expect(JSON.parse(out)).toEqual([{ title: 'Broken build' }]);
  });
```

Also `gh issue list --label bug` goes through search in `gh`; add that command to the case if the first passes.

- [ ] **Step 5: Run, then commit**

Run: `$E2E test/github-graphql.e2e-spec.ts`, unit and conformance tests. Expected: PASS.

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: GitHub issue search for gh issue list --search"
```

---

### Task 12: Issue mutations

**Files:**
- Create: `apps/api/src/github/graphql/types/mutations.type.ts`, `apps/api/src/github/graphql/resolvers/issue-mutations.resolver.ts`
- Modify: `github.module.ts`, tests

**Interfaces:**
- Produces inputs `CreateIssueInput { repositoryId: ID!, title: String!, body, labelIds: [ID!], assigneeIds: [ID!], clientMutationId }`, `UpdateIssueInput { id: ID!, title, body, state: IssueState, labelIds, assigneeIds, clientMutationId }`, `CloseIssueInput { issueId: ID!, stateReason: IssueClosedStateReason, clientMutationId }`, `ReopenIssueInput { issueId: ID!, clientMutationId }`, `AddCommentInput { subjectId: ID!, body: String!, clientMutationId }`, `AddLabelsToLabelableInput { labelableId: ID!, labelIds: [ID!]!, clientMutationId }`, `RemoveLabelsFromLabelableInput` (same shape), `AddAssigneesToAssignableInput { assignableId: ID!, assigneeIds: [ID!]!, clientMutationId }`, `RemoveAssigneesFromAssignableInput` (same).
- Produces payloads `CreateIssuePayload { issue, clientMutationId }`, `UpdateIssuePayload { issue, clientMutationId }`, `CloseIssuePayload { issue, clientMutationId }`, `ReopenIssuePayload { issue, clientMutationId }`, `AddCommentPayload { commentEdge { node }, subject, timelineEdge, clientMutationId }` (only `commentEdge` and `clientMutationId`), `AddLabelsToLabelablePayload { labelable, clientMutationId }`, `RemoveLabelsFromLabelablePayload`, `AddAssigneesToAssignablePayload { assignable, clientMutationId }`, `RemoveAssigneesFromAssignablePayload`.

Each input's field set must match GitHub's; the conformance test's input check (Task 6) fails when GitHub requires a field we lack. Add `IssueClosedStateReason` enum (`COMPLETED`, `NOT_PLANNED`, `DUPLICATE`) and accept it; Ghost records no reason.

- [ ] **Step 1: Failing e2e cases**

```ts
  it('creates, edits, comments on, labels, closes and reopens an issue through mutations', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id label(name: "bug") { id } } viewer { id } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const { id: repositoryId, label } = repo.body.data.repository;
    const viewerId = repo.body.data.viewer.id;

    const created = await graphql('mutation($input: CreateIssueInput!) { createIssue(input: $input) { clientMutationId issue { id number title url labels(first: 10) { nodes { name } } assignees(first: 10) { nodes { login } } } } }', { input: { repositoryId, title: 'From gh', body: 'Body', labelIds: [label.id], assigneeIds: [viewerId], clientMutationId: 'c1' } }, owner.key).expect(200);
    expect(created.body.errors).toBeUndefined();
    const issue = created.body.data.createIssue.issue;
    expect(created.body.data.createIssue.clientMutationId).toBe('c1');
    expect(issue.labels.nodes).toEqual([{ name: 'bug' }]);
    expect(issue.assignees.nodes).toEqual([{ login: username }]);

    const updated = await graphql('mutation($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { title } } }', { input: { id: issue.id, title: 'Renamed' } }, owner.key).expect(200);
    expect(updated.body.data.updateIssue.issue.title).toBe('Renamed');

    const comment = await graphql('mutation($input: AddCommentInput!) { addComment(input: $input) { commentEdge { node { body url } } } }', { input: { subjectId: issue.id, body: 'Thanks' } }, owner.key).expect(200);
    expect(comment.body.data.addComment.commentEdge.node.body).toBe('Thanks');

    const removed = await graphql('mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { labelable { ...on Issue { labels(first: 10) { totalCount } } } } }', { input: { labelableId: issue.id, labelIds: [label.id] } }, owner.key).expect(200);
    expect(removed.body.data.removeLabelsFromLabelable.labelable.labels.totalCount).toBe(0);

    const closed = await graphql('mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { state stateReason } } }', { input: { issueId: issue.id, stateReason: 'NOT_PLANNED' } }, owner.key).expect(200);
    expect(closed.body.data.closeIssue.issue.state).toBe('CLOSED');

    const reopened = await graphql('mutation($input: ReopenIssueInput!) { reopenIssue(input: $input) { issue { state } } }', { input: { issueId: issue.id } }, owner.key).expect(200);
    expect(reopened.body.data.reopenIssue.issue.state).toBe('OPEN');
  });

  it('refuses mutations without a viewer, and refuses a node id of the wrong type', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const anonymous = await graphql('mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { id } } }', { input: { repositoryId: repo.body.data.repository.id, title: 'x' } }).expect(200);
    expect(anonymous.body.errors[0].type).toBe('FORBIDDEN');
    const wrongType = await graphql('mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id } } }', { input: { issueId: repo.body.data.repository.id } }, owner.key).expect(200);
    expect(wrongType.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: expect.stringContaining('Could not resolve to a node with the global id of') });
  });

  it('refuses a stranger writing to a public repository with FORBIDDEN', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { issues(first: 1) { nodes { id } } } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const response = await graphql('mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id } } }', { input: { issueId: repo.body.data.repository.issues.nodes[0].id } }, stranger.key).expect(200);
    expect(response.body.errors[0].type).toBe('FORBIDDEN');
  });
```

Run; Expected: FAIL.

- [ ] **Step 2: Inputs and payloads**

`mutations.type.ts`: one `@InputType(<GitHub name>)` class per input and one `@ObjectType(<GitHub name>)` per payload, fields exactly as listed in this task's Interfaces, `@Field(() => ID)` for ids, `@Field(() => [ID])` for id lists, `nullable: true` wherever GitHub's input field is optional. `AddCommentPayload.commentEdge` is `IssueCommentEdge { node: IssueComment }`: declare `@ObjectType('IssueCommentEdge') class IssueCommentEdge { @Field(() => String) cursor; @Field(() => IssueCommentNode, { nullable: true }) node }` here, and answer `cursor: ''`. `labelable` and `assignable` fields are typed with `Labelable` / `Assignable` interfaces: add them to `node.interface.ts` with no fields beyond what GitHub's interfaces declare that Issue implements (`labels(first: Int): LabelConnection` for `Labelable`, `assignees(first: Int): UserConnection!` for `Assignable`), and add both to `IssueNode`'s `implements`. If Nest refuses connection-with-args on interface fields, type the payload fields with `IssueNode` instead and accept the conformance test's message only if it passes; otherwise keep the interface without fields and use `resolveType`.

- [ ] **Step 3: Resolver**

```ts
import type { Database } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { DATABASE } from '../../../database/database.module.js';
import { CouldNotResolveError, GithubForbiddenError } from '../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../lib/github/loaders.js';
import { decodeNodeIdAs } from '../../../lib/github/node-id.js';
import { issueRefOf, labelNamesOf, usernamesOf } from '../../../lib/github/node-lookup.js';
import { toIssueCommentNode } from '../../../lib/github/nodes.js';
import { RepositoryForbiddenError } from '../../../lib/repositories/access/repository-access.errors.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { IssueNode } from '../types/issue.type.js';
import * as M from '../types/mutations.type.js';
import type { RepositoryNode } from '../types/repository.type.js';
import { IssueResolver } from './issue.resolver.js';
import { RepositoryResolver } from './repository.resolver.js';

type IssueRef = { username: string; repo: string; number: number; requesterId: string };

@Resolver()
@AllowAnonymous()
export class IssueMutationsResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryResolver,
    private readonly issueNodes: IssueResolver,
  ) {}

  @Mutation(() => M.CreateIssuePayload, { nullable: true })
  async createIssue(@Args('input') input: M.CreateIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'CreateIssue');
    const repository = await this.repositoryFor(input.repositoryId, userId);
    const labels = await this.labelNames(repository, input.labelIds ?? []);
    const assignees = await this.usernames(input.assigneeIds ?? []);
    const created = await this.write('CreateIssue', userId, context, () =>
      this.issues.createIssue({ username: repository.ownerLogin, repo: repository.slug, requesterId: userId, body: { title: input.title, body: input.body ?? undefined, labels, assignees } }),
    );
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, created.number, userId) };
  }

  @Mutation(() => M.UpdateIssuePayload, { nullable: true })
  async updateIssue(@Args('input') input: M.UpdateIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'UpdateIssue');
    const { repository, ref } = await this.issueRef(input.id, userId);
    const labels = input.labelIds ? await this.labelNames(repository, input.labelIds) : null;
    const assignees = input.assigneeIds ? await this.usernames(input.assigneeIds) : null;
    // ponytail: one transaction per changed aspect; a failure midway keeps the earlier changes. Add IssuesService.updateMany if gh users hit it.
    await this.write('UpdateIssue', userId, context, async () => {
      if (input.title != null || input.body !== undefined) await this.issues.updateIssue({ ...ref, body: { title: input.title ?? undefined, body: input.body } });
      if (input.state === 'CLOSED') await this.issues.closeIssue(ref);
      if (input.state === 'OPEN') await this.issues.reopenIssue(ref);
      if (labels) await this.issues.setIssueLabels({ ...ref, names: labels });
      if (assignees) await this.issues.setIssueAssignees({ ...ref, usernames: assignees });
    });
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, ref.number, userId) };
  }

  @Mutation(() => M.CloseIssuePayload, { nullable: true })
  async closeIssue(@Args('input') input: M.CloseIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'CloseIssue');
    const { repository, ref } = await this.issueRef(input.issueId, userId);
    await this.write('CloseIssue', userId, context, () => this.issues.closeIssue(ref));
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, ref.number, userId) };
  }

  @Mutation(() => M.ReopenIssuePayload, { nullable: true })
  async reopenIssue(@Args('input') input: M.ReopenIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'ReopenIssue');
    const { repository, ref } = await this.issueRef(input.issueId, userId);
    await this.write('ReopenIssue', userId, context, () => this.issues.reopenIssue(ref));
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, ref.number, userId) };
  }

  @Mutation(() => M.AddCommentPayload, { nullable: true })
  async addComment(@Args('input') input: M.AddCommentInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'AddComment');
    const { repository, ref } = await this.issueRef(input.subjectId, userId);
    const comment = await this.write('AddComment', userId, context, () => this.issues.createComment({ ...ref, body: input.body }));
    const issue = await this.issueOnly(repository, ref, input.subjectId);
    const login = await this.loginOf(userId, context);
    return { clientMutationId: input.clientMutationId, commentEdge: { cursor: '', node: toIssueCommentNode({ ...comment, authorUsername: login }, issue, login) } };
  }

  @Mutation(() => M.AddLabelsToLabelablePayload, { nullable: true })
  async addLabelsToLabelable(@Args('input') input: M.AddLabelsToLabelableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'AddLabelsToLabelable');
    const { repository, ref } = await this.issueRef(input.labelableId, userId);
    const current = (await this.issueOnly(repository, ref, input.labelableId)).labelDtos.map((label) => label.name);
    const added = await this.labelNames(repository, input.labelIds);
    await this.write('AddLabelsToLabelable', userId, context, () => this.issues.setIssueLabels({ ...ref, names: [...new Set([...current, ...added])] }));
    return { clientMutationId: input.clientMutationId, labelable: await this.issueOnly(repository, ref, input.labelableId) };
  }

  @Mutation(() => M.RemoveLabelsFromLabelablePayload, { nullable: true })
  async removeLabelsFromLabelable(@Args('input') input: M.RemoveLabelsFromLabelableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'RemoveLabelsFromLabelable');
    const { repository, ref } = await this.issueRef(input.labelableId, userId);
    const current = (await this.issueOnly(repository, ref, input.labelableId)).labelDtos.map((label) => label.name);
    const removed = new Set(await this.labelNames(repository, input.labelIds));
    await this.write('RemoveLabelsFromLabelable', userId, context, () => this.issues.setIssueLabels({ ...ref, names: current.filter((name) => !removed.has(name)) }));
    return { clientMutationId: input.clientMutationId, labelable: await this.issueOnly(repository, ref, input.labelableId) };
  }

  @Mutation(() => M.AddAssigneesToAssignablePayload, { nullable: true })
  async addAssigneesToAssignable(@Args('input') input: M.AddAssigneesToAssignableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'AddAssigneesToAssignable');
    const { repository, ref } = await this.issueRef(input.assignableId, userId);
    const current = (await this.issueOnly(repository, ref, input.assignableId)).assigneeLogins;
    const added = await this.usernames(input.assigneeIds);
    await this.write('AddAssigneesToAssignable', userId, context, () => this.issues.setIssueAssignees({ ...ref, usernames: [...new Set([...current, ...added])] }));
    return { clientMutationId: input.clientMutationId, assignable: await this.issueOnly(repository, ref, input.assignableId) };
  }

  @Mutation(() => M.RemoveAssigneesFromAssignablePayload, { nullable: true })
  async removeAssigneesFromAssignable(@Args('input') input: M.RemoveAssigneesFromAssignableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'RemoveAssigneesFromAssignable');
    const { repository, ref } = await this.issueRef(input.assignableId, userId);
    const current = (await this.issueOnly(repository, ref, input.assignableId)).assigneeLogins;
    const removed = new Set(await this.usernames(input.assigneeIds));
    await this.write('RemoveAssigneesFromAssignable', userId, context, () => this.issues.setIssueAssignees({ ...ref, usernames: current.filter((login) => !removed.has(login)) }));
    return { clientMutationId: input.clientMutationId, assignable: await this.issueOnly(repository, ref, input.assignableId) };
  }

  private require(viewer: GithubViewer | null, mutation: string) {
    if (!viewer) throw new GithubForbiddenError(`You must be signed in to run ${mutation}.`);
    return viewer.userId;
  }

  private unresolved(nodeId: string) {
    return new CouldNotResolveError(`Could not resolve to a node with the global id of '${nodeId}'`);
  }

  private async repositoryFor(nodeId: string, userId: string) {
    const repositoryId = decodeNodeIdAs(nodeId, 'Repository');
    return this.repositories.load(repositoryId, userId).catch(() => {
      throw this.unresolved(nodeId);
    });
  }

  /** The issue a node id names, with the IssueRef the service methods take. */
  private async issueRef(nodeId: string, userId: string): Promise<{ repository: RepositoryNode; ref: IssueRef }> {
    const found = await issueRefOf(this.db, decodeNodeIdAs(nodeId, 'Issue'));
    if (!found) throw this.unresolved(nodeId);
    const repository = await this.repositories.load(found.repositoryId, userId).catch(() => {
      throw this.unresolved(nodeId);
    });
    return { repository, ref: { username: repository.ownerLogin, repo: repository.slug, number: found.number, requesterId: userId } };
  }

  /** Pull request mutations arrive with milestone 3, so a number that is a pull request reads as unresolved here. */
  private async issueOnly(repository: RepositoryNode, ref: IssueRef, nodeId: string) {
    const found = await this.issueNodes.fromRepository(repository, ref.number, ref.requesterId);
    if (!(found instanceof IssueNode)) throw this.unresolved(nodeId);
    return found;
  }

  private labelNames(repository: RepositoryNode, labelIds: string[]) {
    return labelNamesOf(this.db, repository.ghostId, labelIds.map((id) => decodeNodeIdAs(id, 'Label')));
  }

  private usernames(userIds: string[]) {
    return usernamesOf(this.db, userIds.map((id) => decodeNodeIdAs(id, 'User')));
  }

  private async loginOf(userId: string, { loaders }: GraphqlContext) {
    return (await loaders.usersById.load(userId))?.username ?? '';
  }

  /** Runs a write; a permission refusal reads as GitHub's FORBIDDEN wording, which names the login. */
  private async write<T>(mutation: string, userId: string, context: GraphqlContext, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof RepositoryForbiddenError) throw new GithubForbiddenError(`${await this.loginOf(userId, context)} does not have the correct permissions to execute \`${mutation}\``);
      throw error;
    }
  }
}
```

Check `createComment`'s return shape at `issues.service.ts:515`: the spread assumes it returns `{ id, body, createdAt, updatedAt }` as ISO strings (`commentColumns`). If it returns rows with `Date`s, convert with `.toISOString()` when building the `CommentRow`.

Register `IssueMutationsResolver` in `GithubModule`.

- [ ] **Step 4: `gh` cases**

```ts
  it('creates an issue with a label and an assignee', async () => {
    const out = await ok(['issue', 'create', '-R', `${GH_E2E_HOST}/${username}/tools`, '--title', 'Made by gh', '--body', 'Body', '--label', 'bug', '--assignee', username]);
    expect(out).toMatch(new RegExp(`/${username}/tools/issues/\\d+`));
  });

  it('comments on, edits, closes and reopens an issue', async () => {
    const repo = `${GH_E2E_HOST}/${username}/tools`;
    await ok(['issue', 'comment', '1', '-R', repo, '--body', 'From gh']);
    await ok(['issue', 'edit', '1', '-R', repo, '--title', 'Broken build (edited)', '--add-label', 'bug']);
    await ok(['issue', 'close', '1', '-R', repo]);
    expect(JSON.parse(await ok(['issue', 'view', '1', '-R', repo, '--json', 'state,title,labels']))).toMatchObject({ state: 'CLOSED', title: 'Broken build (edited)', labels: [{ name: 'bug' }] });
    await ok(['issue', 'reopen', '1', '-R', repo]);
  });
```

Create label `bug` on `tools` in `beforeAll`.

- [ ] **Step 5: Run, then commit**

Run: `$E2E test/github-graphql.e2e-spec.ts` plus unit and conformance. Expected: PASS.

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: GitHub issue mutations for gh issue create, edit, comment, close and reopen"
```

---

### Task 13: Repository creation (`createRepository`, REST `POST /user/repos`, `/orgs/:org/repos`, `GET /users/:login`)

**Files:**
- Create: `apps/api/src/github/graphql/resolvers/repository-mutations.resolver.ts`
- Modify: `mutations.type.ts` (`CreateRepositoryInput`, `CreateRepositoryPayload`), `repos.controller.ts`, `users.controller.ts`, `github.module.ts`, tests

**Interfaces:**
- Consumes `RepositoriesService.createRepository(body: CreateRepositoryRequestDTO, userId: string): Promise<{ id; slug }>` and `RepositoryResolver.load`.
- Produces `CreateRepositoryInput { name: String!, ownerId: ID, description: String, visibility: RepositoryVisibility!, template: Boolean, homepageUrl: URI, hasWikiEnabled: Boolean, hasIssuesEnabled: Boolean, teamId: ID, clientMutationId }` and `CreateRepositoryPayload { repository, clientMutationId }`.

- [ ] **Step 1: Failing cases**

GraphQL e2e:

```ts
  it('creates a repository for the viewer and for an organization through createRepository', async () => {
    const viewer = await graphql('{ viewer { id } }', {}, owner.key).expect(200);
    const response = await graphql('mutation($input: CreateRepositoryInput!) { createRepository(input: $input) { repository { name nameWithOwner visibility url } } }', { input: { name: 'made-by-gh', visibility: 'PRIVATE', ownerId: viewer.body.data.viewer.id, description: 'x' } }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.createRepository.repository).toMatchObject({ name: 'made-by-gh', nameWithOwner: `${username}/made-by-gh`, visibility: 'PRIVATE' });
  });
```

REST e2e:

```ts
  it('creates a repository with POST /user/repos and answers GET /users/:login', async () => {
    const created = await request(app.getHttpServer()).post('/api/v3/user/repos').set('authorization', `token ${owner.key}`).send({ name: 'rest-made', private: true, auto_init: true }).expect(201);
    expect(created.body).toMatchObject({ name: 'rest-made', full_name: `${username}/rest-made`, private: true });
    const user = await v3(`/users/${username}`).expect(200);
    expect(user.body).toMatchObject({ login: username, type: 'User' });
    await v3('/users/nobody-xyz').expect(404);
  });
```

`gh`:

```ts
  it('creates a repository', async () => {
    const out = await ok(['repo', 'create', `${GH_E2E_HOST}/${username}/gh-made`, '--private', '--description', 'from gh']);
    expect(out).toContain(`${username}/gh-made`);
  });
```

Run; Expected: FAIL.

- [ ] **Step 2: Mutation**

```ts
@Resolver()
@AllowAnonymous()
export class RepositoryMutationsResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositories: RepositoriesService,
    private readonly repositoryNodes: RepositoryResolver,
  ) {}

  @Mutation(() => M.CreateRepositoryPayload, { nullable: true })
  async createRepository(@Args('input') input: M.CreateRepositoryInput, @Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new GithubForbiddenError('You must be signed in to run CreateRepository.');
    const owner = input.ownerId ? decodeNodeId(input.ownerId) : null;
    if (input.ownerId && owner?.type !== 'User' && owner?.type !== 'Organization') throw new CouldNotResolveError(`Could not resolve to a node with the global id of '${input.ownerId}'`);
    if (owner?.type === 'User' && owner.id !== viewer.userId) throw new GithubForbiddenError('You can only create repositories for yourself or an organization you administer.');
    const organization = owner?.type === 'Organization' ? await this.organizationSlug(owner.id) : undefined;
    const created = await this.repositories.createRepository(
      { name: input.name, description: input.description ?? undefined, visibility: input.visibility === RepositoryVisibility.PUBLIC ? 'public' : 'private', organization },
      viewer.userId,
    );
    return { clientMutationId: input.clientMutationId, repository: await this.repositoryNodes.load(created.id, viewer.userId) };
  }

  private async organizationSlug(organizationId: string) {
    const [row] = await this.db.select({ slug: schema.organization.slug }).from(schema.organization).where(eq(schema.organization.id, organizationId));
    if (!row) throw new CouldNotResolveError('Could not resolve to an Organization.');
    return row.slug;
  }
}
```

`gh repo create OWNER/NAME` looks the owner up first; with the viewer's own login it sends no `ownerId`. `hasIssuesEnabled`, `hasWikiEnabled`, `homepageUrl` and `template` are accepted and ignored (Ghost has no such settings); `gh` follows a non-default value with `updateRepository`, which milestone 1 does not serve, so `gh repo create --disable-issues` fails with GitHub's unknown-field error. List it on the compatibility page (Task 16).

- [ ] **Step 3: REST**

In `repos.controller.ts`:

```ts
  @Post('user/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository for the authenticated user' })
  createForUser(@Body() body: GithubCreateRepositoryDTO, @Viewer() viewer: GithubViewer | null) {
    return this.create(body, viewer, undefined);
  }

  @Post('orgs/:org/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository in an organization' })
  createForOrganization(@Param('org') org: string, @Body() body: GithubCreateRepositoryDTO, @Viewer() viewer: GithubViewer | null) {
    return this.create(body, viewer, org);
  }

  private async create(body: GithubCreateRepositoryDTO, viewer: GithubViewer | null, organization: string | undefined) {
    if (!viewer) throw new RequiresAuthenticationError();
    const visibility = body.visibility ?? (body.private ? 'private' : 'public');
    const created = await this.repositories.createRepository({ name: body.name, description: body.description, visibility, organization }, viewer.userId);
    const node = await this.repositoryNodes.load(created.id, viewer.userId);
    return this.get(node.ownerLogin, node.slug, viewer);
  }
```

`GithubCreateRepositoryDTO` (in `apps/api/src/github/rest/dto/create-repository.dto.ts`, `class-validator` decorated, `@ApiProperty` documented): `name: string` (required), `description?: string`, `private?: boolean`, `visibility?: 'public' | 'private'`, `auto_init?: boolean`, `gitignore_template?: string`, `license_template?: string`. The global `ValidationPipe` uses `whitelist: true`, so every accepted GitHub field must be declared or it is stripped silently. `auto_init`, `gitignore_template` and `license_template` are accepted and ignored in milestone 1; Ghost cannot write an initial commit from the API yet. List that on the compatibility page.

In `users.controller.ts`, add `GET users/:login`: a user by username in the same shape as `/user` minus `email`, or an organization (`type: 'Organization'`) by slug; neither means `CouldNotResolveError` (404 "Not Found" through the filter). Build the object in the handler.

Register `RepositoryMutationsResolver` in `GithubModule`.

- [ ] **Step 4: Run, then commit**

```bash
git add apps/api/src apps/api/test apps/api/github.schema.gql
git commit -m "api: create repositories through GitHub's createRepository and REST routes"
```

---

### Task 14: SSH keys over REST (`gh ssh-key list/add`)

**Files:**
- Modify: `apps/api/src/github/rest/users.controller.ts`, `github.module.ts` (import `SshKeysModule`)
- Create: `apps/api/src/github/rest/dto/add-key.dto.ts`
- Modify: tests

**Interfaces:** Consumes `SshKeysService.list(userId)`, `.add(userId, line, title?)`.

- [ ] **Step 1: Failing cases**

REST e2e:

```ts
  it('lists and adds SSH keys in GitHub shape', async () => {
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl e2e';
    const added = await request(app.getHttpServer()).post('/api/v3/user/keys').set('authorization', `token ${owner.key}`).send({ title: 'laptop', key }).expect(201);
    expect(added.body).toMatchObject({ title: 'laptop', key: expect.stringContaining('ssh-ed25519'), read_only: false, verified: true });
    const listed = await v3('/user/keys', owner.key).expect(200);
    expect(listed.body).toContainEqual(expect.objectContaining({ title: 'laptop' }));
  });
```

`gh`:

```ts
  it('adds and lists SSH keys', async () => {
    const keyFile = path.join(configDir, 'id.pub');
    writeFileSync(keyFile, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA6dP3MFVcBMIcbhjAkmvG9w8Ojt1W2JaCC/JXLvK1Ow gh-e2e\n');
    await ok(['ssh-key', 'add', keyFile, '--title', 'gh-e2e']);
    expect(await ok(['ssh-key', 'list'])).toContain('gh-e2e');
  });
```

If either fixed key fails Ghost's parser, generate a fresh one with `ssh-keygen -t ed25519 -N '' -f /tmp/k -q && cat /tmp/k.pub` and paste it in.

- [ ] **Step 2: Routes**

```ts
  @Get('user/keys')
  @ApiOperation({ summary: "The authenticated user's SSH keys, in GitHub REST shape" })
  async keys(@Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    const { keys } = await this.sshKeys.list(viewer.userId);
    return keys.map((key) => ({ id: null, key: key.publicKey, title: key.title, created_at: key.createdAt, read_only: false, verified: true }));
  }

  @Post('user/keys')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add an SSH key to the authenticated user' })
  async addKey(@Body() body: GithubAddKeyDTO, @Viewer() viewer: GithubViewer | null) {
    if (!viewer) throw new RequiresAuthenticationError();
    const key = await this.sshKeys.add(viewer.userId, body.key, body.title);
    return { id: null, key: body.key.trim(), title: key.title, created_at: key.createdAt, read_only: false, verified: true };
  }
```

`SshKeysService.list` drops `publicKey` from its DTO (`rows.map(({ publicKey, ...key }) => …)`). GitHub returns the key text, and `gh ssh-key list` prints it. Add `publicKey` to `SshKeyDTO` and stop dropping it in `list` (a public key is public); update `ssh-key.dto.ts` with an `@ApiProperty` and regenerate the web client types with `bun run openapi` from the repository root. That is a one-line service change, made where the data is produced, per code standard 2.

`GithubAddKeyDTO`: `title?: string` (`@MaxLength(MAX_TITLE_LENGTH)`), `key: string` (`@MaxLength(MAX_PUBLIC_KEY_LENGTH)`), both imported from `ssh-key.dto.ts`.

- [ ] **Step 3: Run, then commit**

```bash
git add apps/api/src apps/api/test apps/web/src/lib/api/v1.d.ts apps/api/openapi.json
git commit -m "api: list and add SSH keys through GitHub's REST routes"
```

---

### Task 15: GraphiQL with a session, OpenAPI tag check, error shapes for unknown fields

**Files:**
- Modify: `apps/api/test/github-graphql.e2e-spec.ts`, `apps/api/test/github-rest.e2e-spec.ts`

**Interfaces:** none new. This task pins behavior other tasks produced.

- [ ] **Step 1: Cases**

```ts
  it('serves GraphiQL to a browser and accepts the session cookie there', async () => {
    const page = await request(app.getHttpServer()).get('/api/graphql').set('accept', 'text/html').expect(200);
    expect(page.text).toContain('graphiql');
    const response = await request(app.getHttpServer()).post('/api/graphql').set('cookie', owner.cookie).send({ query: '{ viewer { login } }' }).expect(200);
    expect(response.body.data.viewer.login).toBe(username);
  });

  it('answers an unknown field with a validation error naming it, which gh prints', async () => {
    const response = await graphql('{ viewer { login notAField } }', {}, owner.key).expect(400);
    expect(response.body.errors[0].message).toContain('notAField');
  });
```

REST:

```ts
  it('lists the compat routes in the OpenAPI document under GitHub compatibility', async () => {
    const { SwaggerModule } = await import('@nestjs/swagger');
    const { openApiConfig } = await import('../src/lib/openapi.js');
    const document = SwaggerModule.createDocument(app, openApiConfig);
    expect(document.paths['/api/v3/user']?.get?.tags).toEqual(['GitHub compatibility']);
  });
```

Apollo answers a validation error with HTTP 400; GitHub answers 200. `gh` handles both. If the reviewer wants GitHub's status, set Apollo's `status400ForVariableCoercionErrors: false` and check validation errors; otherwise keep 400 and record the difference on the compatibility page.

- [ ] **Step 2: Run, fix what fails, commit**

Run: `$E2E test/github-graphql.e2e-spec.ts test/github-rest.e2e-spec.ts`. If the OpenAPI path key differs (`/api/v3/user` vs `/v3/user`), match what `document.paths` holds.

```bash
git add apps/api/test
git commit -m "api: pin GraphiQL, unknown-field errors and the OpenAPI tag for the GitHub routes"
```

---

### Task 16: ADR 0040, compatibility page, spec layout fix

**Files:**
- Create: `docs/0040-github-compatibility-is-a-translation-layer.md`
- Create: `apps/docs/content/docs/github-compatibility.mdx`
- Modify: `apps/docs/content/docs/meta.json` (add the page)
- Modify: `docs/superpowers/specs/2026-10-09-gh-cli-compat-design.md` (layout: `src/lib/github/`, no extra body parser)
- Modify: `README.md` (Features: one line)

**Interfaces:** none.

- [ ] **Step 1: ADR**

Follow the existing ADR format (`docs/0039-*.md`): title, `**Status:** adopted`, `## Decision`, `## Why`, `## Consequences`. Content:

- Decision: GitHub's GraphQL and REST APIs are served by `apps/api/src/github/` at `/api/graphql` and `/api/v3` on the API host; users set `GH_HOST=api.<domain>`. Pure helpers live in `src/lib/github/`, and only `src/github/` imports them. `toX` mappers are allowed there and nowhere else, each with a line saying why a query could not select GitHub's shape, and are a last resort. The GraphQL schema is code-first, committed as `apps/api/github.schema.gql`, and checked against `@octokit/graphql-schema` in CI. Node ids are `<GitHub prefix>_<base64url(Ghost id)>`. `/api/v3/meta` reports GHES `3.17.0`. Introspection and GraphiQL are on everywhere. REST routes appear in OpenAPI under `GitHub compatibility`.
- Why: `gh` treats any host but github.com as GHES with those paths; the API host already serves `/api` and the git transport, so `gh repo clone` and credentials resolve against the same host. Code-first with a conformance test catches a misspelled field in CI rather than in `gh`. 3.17.0 keeps `gh` on the classic search syntax Ghost can translate.
- Rejected: hand-written SDL (error-prone, the user's call), vendoring GitHub's full schema at runtime (70k lines of unresolved fields), a separate service (the translation needs every Ghost service).
- Consequences: `databaseId` and REST `id` are null; milestones, reactions, issue types, sub-issues answer empty; Ghost features without a GitHub equivalent are not exposed; the compatibility page lists differences; plan 2 adds OAuth apps and scopes.

- [ ] **Step 2: Compatibility page**

`apps/docs/content/docs/github-compatibility.mdx`, following the frontmatter style of `webhooks.mdx`. Sections: Setup (`gh auth login --hostname api.<domain> --with-token`, `GH_HOST`), Supported commands (each milestone-1 command, each covered by `test/gh-cli.e2e-spec.ts`), GraphQL types and REST routes served, Known differences (null `databaseId`/`id`; empty milestones, reactions, issue types, sub-issues; close reason always `COMPLETED`; `authorAssociation` only `OWNER`/`NONE`; `auto_init`/templates ignored on create; `gh repo create --disable-issues/--disable-wiki/--homepage` unsupported; validation errors answer 400; global search across repositories unsupported), Not yet supported (`gh auth login --web`, `gh auth refresh`, pull requests, releases, gists, GitHub Apps, fine-grained PATs). Add `"github-compatibility"` to `meta.json` beside `webhooks`.

- [ ] **Step 3: Spec layout fix**

In the spec's Layout block and "Exception to code standard 2", replace `src/github/lib/` with `apps/api/src/lib/github/` and add one line: "Only `src/github/` imports from `src/lib/github/`." In the GraphQL Module section, replace the `express.json()` bullet with: "The auth module's body parsers already parse JSON and form bodies on every non-auth route; git's `application/x-git-*` bodies are untouched."

- [ ] **Step 4: README**

Under Features, add: `- Works with the GitHub CLI: point \`GH_HOST\` at the API host for \`gh repo\`, \`gh issue\` and \`gh api\``. Remove nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/0040-github-compatibility-is-a-translation-layer.md apps/docs/content/docs README.md docs/superpowers/specs/2026-10-09-gh-cli-compat-design.md
git commit -m "docs: GitHub compatibility decision, compatibility page and spec layout"
```

---

### Task 17: Full verification and PR

- [ ] **Step 1: Everything locally**

From `apps/api`: `bunx vitest run`, then `$E2E`. From the root: `bun run lint`, `bun run check-types`.
Expected: all PASS except the two known e2e failures recorded in memory if Task 1 has not merged (`webhook-events` release case) and the local-`.env` `storage-limits` case.

- [ ] **Step 2: Schema is current**

`git status --short apps/api/github.schema.gql` prints nothing.

- [ ] **Step 3: Push and watch CI**

```bash
git push
gh run watch --exit-status $(gh run list --workflow api.yml --branch gh-compat/docs --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: green, including `gh CLI` cases. If a `gh` case fails with "Cannot query field X on type Y", add field X to Y (the conformance test then checks its type), re-run.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --title "GitHub CLI compatibility, part 1: GraphQL, REST and token auth" --body "$(cat <<'EOF'
Closes part of #57. Serves GitHub's GraphQL API at /api/graphql and REST v3 at /api/v3 on the API host, so `GH_HOST=api.<domain> gh …` works for auth with a pasted token, gh api, gh repo view/clone/create, gh issue list/view/create/comment/close/reopen/edit and gh ssh-key list/add.

- Code-first schema (`apps/api/github.schema.gql`), checked against GitHub's published schema in CI
- Real gh 2.102 runs in CI against the app over HTTPS
- New API workflow on every PR and push to main
- ADR 0040 and a compatibility page listing what differs from GitHub

Spec: docs/superpowers/specs/2026-10-09-gh-cli-compat-design.md
Plan: docs/superpowers/plans/2026-10-09-gh-cli-compat-1-graphql-rest.md

OAuth apps, device flow (`gh auth login --web`) and scopes follow in part 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Memory says the user does not want Claude attribution in commits and is unsure about PR descriptions. Ask before opening the PR whether to keep the last line.
