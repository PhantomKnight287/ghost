# gh CLI compatibility, plan 2 of 3: scopes and the device flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tokens carry GitHub scopes that Ghost enforces, and `gh auth login --web`, `gh auth refresh` and `gh auth setup-git` work against Ghost.

**Architecture:** An API key's `permissions.scopes` holds the GitHub scopes it was granted. A key without them (made in Ghost's UI) and a browser session hold every scope. One pure module, `src/lib/github/scopes.ts`, decides whether granted scopes cover a need. The compat layer and the git middleware call it. Better Auth's `deviceAuthorization` plugin runs the device flow. Two controllers at the API host root, `/login/device/code` and `/login/oauth/access_token`, translate it to GitHub's wire format. On approval they mint a scoped `ghost_pat_` key instead of handing out the plugin's session. The web app gets a `/device` page.

**Tech Stack:** NestJS 12, Better Auth 1.7.2 (`deviceAuthorization` from `better-auth/plugins`, `deviceAuthorizationClient` from `better-auth/client/plugins`), `@better-auth/api-key` 1.7.3, Drizzle, Next.js (web), vitest + supertest, real `gh` 2.102 in CI.

**Spec:** `docs/superpowers/specs/2026-10-09-gh-cli-compat-design.md`, sections "Auth", "Tokens", "Scopes" and "Device flow". Outline: `2026-10-09-gh-cli-compat-2-auth-outline.md`.

**Out of scope, plan 3:** user-registered OAuth apps, the authorization-code flow (`GET /login/oauth/authorize`, `grant_type=authorization_code`), the "OAuth apps" and "Authorized apps" settings pages, and `@better-auth/oauth-provider`. `gh` needs none of them. Until plan 3, the only OAuth app is `gh`, held as a constant. Keys `gh` receives show in the existing API keys settings page, where they can be revoked.

## Facts established while planning (read before starting)

From `gh` v2.102.0 (`internal/authflow/flow.go`) and `cli/oauth` v1.2.2 (`device/device_flow.go`, `api/form.go`):

- `gh` uses one OAuth client id for every host, github.com and Enterprise alike: `178c6fc778ccc68e1d6a`. It also sends a client secret (`34ddeff2b558a23d38fba8a6de74f086ede1cc0b`), which Ghost ignores.
- `gh auth login --web` asks for `repo read:org gist`. `gh auth refresh -s X` asks for those plus `X`.
- Device code request: `POST https://HOST/login/device/code`, form body `client_id`, `scope` (space-separated). `cli/oauth` sends no `Accept` header. It parses the response by its `Content-Type`, `application/x-www-form-urlencoded` or `application/json`. JSON numbers are accepted.
- A 401, 403, 404 or 422 from `/login/device/code`, or a 200 without `verification_uri`, makes `cli/oauth` fall back to the web-application flow on a localhost callback. Ghost does not serve that flow, so `/login/device/code` must answer 200 for `gh`'s client id.
- `interval` and `expires_in` are required, and are parsed as integers.
- Polling: `POST https://HOST/login/oauth/access_token`, form body `client_id`, `device_code`, `grant_type=urn:ietf:params:oauth:grant-type:device_code`, plus `client_secret`. The status code is ignored. A body with `access_token` succeeds. Otherwise `error` decides: `authorization_pending` keeps polling, `slow_down` waits longer (an `interval` in the body sets the new wait), and anything else is fatal.
- The plugin's `/device/token` (`auth.api.deviceToken`) throws `APIError` whose `body.error` is one of `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, `invalid_grant`. On success it creates a Better Auth session and returns its token. Ghost must not hand that out: it would be a full browser session.
- The plugin's `GET /device?user_code=` claims a pending code for the signed-in user and returns `{ user_code, status, client_id, scope }`. `POST /device/approve` and `/device/deny` take `{ userCode }` and need that same session.
- Plugin defaults: codes expire in 30 minutes, the polling interval is 5 seconds, user codes are 8 characters. The table model is `deviceCode`. Ghost's `drizzleAdapter(db, { provider: 'pg' })` finds tables by their export name in `@ghost/db`'s schema.
- `@better-auth/api-key` runs with `enableSessionForAPIKeys` off, its default. API keys therefore authenticate only the git transport and the compat layer (`/api/v3`, `/api/graphql`), never Ghost's own `/api`. Spec item "Ghost's own REST API refuses keys issued to OAuth apps" already holds. Task 1 pins it with a test.
- The git routes at the root are `:username/:repo/info/refs`, `…/git-upload-pack`, `…/git-receive-pack` and `…/info/lfs/…`, so `/login/device/code` and `/login/oauth/access_token` cannot match them. They only need excluding from the `/api` prefix.

## Global Constraints

- Scope names are GitHub's. Known: `repo`, `public_repo`, `read:org`, `write:org`, `admin:org`, `user`, `read:user`, `user:email`, `admin:public_key`, `write:public_key`, `read:public_key`, `delete_repo`, `gist`.
- Implications as on GitHub: `repo` ⊃ `public_repo`; `admin:org` ⊃ `write:org` ⊃ `read:org`; `admin:public_key` ⊃ `write:public_key` ⊃ `read:public_key`; `user` ⊃ `read:user`, `user:email`.
- A key with no `permissions.scopes`, and a session, hold every known scope.
- A key minted by the device flow stores `permissions: { scopes: [...] }` and `metadata: { oauthClientId }`, and is named `GitHub CLI`.
- Reading a private repository needs `repo`. Writing (issue mutations, pushes) needs `repo`, or `public_repo` for a public repository. Creating a repository needs `repo`, or `public_repo` for a public one. `GET /user/keys` needs `read:public_key`; `POST /user/keys` needs `write:public_key`.
- Deviation from the spec, ruled here: the spec asks for one `@RequiresScope()` decorator. Writes need `repo` or `public_repo` depending on the repository's visibility, which a decorator cannot see before the resolver loads the repository. So enforcement is two plain functions, `requireScope` and `requireWriteScope`, called where the repository is known. The check still lives in one module.
- Deviation from the spec, ruled here: `login` and `device` are reserved going forward, with no migration check. An existing account under either name keeps working, and only its web profile path is shadowed by `/device`.
- A missing scope on a readable resource answers 403. On GraphQL that is `type: FORBIDDEN` with GitHub's wording; on REST it is 403 with `X-Accepted-OAuth-Scopes`. A private repository the token may not read answers `NOT_FOUND`, as if it did not exist.
- `/login/device/code` and `/login/oauth/access_token` answer form-encoded, or JSON when the request's `Accept` names `application/json`.
- `verification_uri` is `<WEB_APP_URL>/device`.
- `login` and `device` join `RESERVED_NAMES`.
- Code standards (`docs/code-standards.md`): one-line comments, no `any`, error classes in `apps/api/src/lib/**.errors.ts`, pure functions in `src/lib/`.
- New controllers and resolvers come from `bunx nest g …` (run from `apps/api`), and their generated specs get mock providers.
- Commits: `api: …`, `web: …`, `docs: …`, lower case, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` when Claude writes them.
- E2E only against the throwaway containers. `$E2E` means, run from `apps/api`:
  ```bash
  TEST_DATABASE_URL=postgres://postgres:test@localhost:55433/postgres TEST_S3_ENDPOINT=http://localhost:59000 bunx vitest run --config ./vitest.config.e2e.ts --no-file-parallelism
  ```
- Unit tests: from `apps/api`, `bunx vitest run <path>`.

## Review Focus

1. **A key holding only `public_repo` reading a private repository** must get `NOT_FOUND` on GraphQL, 404 on REST and a refusal over git. It must not get `FORBIDDEN`, or the token leaks that the repository exists. Pinned in Tasks 2 and 3.
2. **A device code polled before approval, after denial, or for another client id** must answer `authorization_pending`, `access_denied` or `invalid_grant` in the body, never an `access_token`. Pinned in Task 4.
3. **The plugin's Better Auth session must never reach `gh`.** The token returned must be a `ghost_pat_` key, and the session created by `deviceToken` must be deleted. Pinned in Task 4.
4. **Scopes `gh` asks for that Ghost does not know** (`gist` is known; `codespace`, `workflow` are not) must be dropped from the grant, not fail the flow. Pinned in Task 1 (unit) and Task 4.
5. **A key made in Ghost's UI** (no `permissions`) must keep working everywhere, with every scope. Pinned in Task 1.

## File structure

```
apps/api/src/lib/github/
  scopes.ts (+ .spec.ts)            KNOWN_SCOPES, hasScope, grantableScopes, scopesOfKey
  github.errors.ts                  (modify) InsufficientScopesError
  oauth-apps.ts                     GH_CLI_APP, oauthAppOf(clientId)
apps/api/src/github/
  auth/github-auth.middleware.ts    (modify) real scopes
  auth/require-scope.ts             requireScope(viewer, needed, …) for resolvers and controllers
  rest/github-rest.filter.ts        (modify) X-Accepted-OAuth-Scopes
  oauth/                            (nest g) oauth.module.ts, oauth.controller.ts (+ spec), oauth-response.ts
apps/api/src/git/middleware/git-basic-auth/git-basic-auth.middleware.ts   (modify) scope check
apps/api/src/lib/auth.ts            (modify) deviceAuthorization plugin, RESERVED_NAMES
apps/api/src/app.setup.ts           (modify) exclude /login routes from /api
packages/db/src/schema/auth.ts      (modify) deviceCode table; migration generated
apps/web/src/lib/auth-client.ts     (modify) deviceAuthorizationClient
apps/web/src/app/device/            layout.tsx, page.tsx, device-form.tsx
apps/api/test/
  harness.ts                        (modify) scopedKey(app, userId, scopes)
  gh.ts                             (modify) startGh() streaming stderr
  github-scopes.e2e-spec.ts         scope enforcement on GraphQL, REST and git
  github-oauth.e2e-spec.ts          device flow over HTTP
  gh-cli.e2e-spec.ts                (modify) gh auth login --web, gh auth refresh
```

---

### Task 1: Scopes on keys, and `X-OAuth-Scopes` that tells the truth

**Files:**
- Create: `apps/api/src/lib/github/scopes.spec.ts`
- Modify: `apps/api/src/lib/github/scopes.ts`, `apps/api/src/github/auth/github-auth.middleware.ts`, `apps/api/test/harness.ts`
- Create: `apps/api/test/github-scopes.e2e-spec.ts`

**Interfaces:**
- Produces `KNOWN_SCOPES: readonly Scope[]`, `type Scope`, `hasScope(granted: readonly string[], needed: Scope): boolean`, `grantableScopes(requested: string): Scope[]`, `scopesOfKey(permissions: Record<string, string[]> | null | undefined): readonly string[]`.
- Produces `scopedKey(app: INestApplication, userId: string, scopes: string[]): Promise<string>` in the harness.
- `ALL_SCOPES` is removed; `KNOWN_SCOPES` replaces it.

- [ ] **Step 1: Failing unit tests**

`apps/api/src/lib/github/scopes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { grantableScopes, hasScope, KNOWN_SCOPES, scopesOfKey } from './scopes.js';

describe('hasScope', () => {
  it('accepts a scope that is granted or implied by a broader one', () => {
    expect(hasScope(['repo'], 'repo')).toBe(true);
    expect(hasScope(['repo'], 'public_repo')).toBe(true);
    expect(hasScope(['admin:org'], 'read:org')).toBe(true);
    expect(hasScope(['admin:public_key'], 'read:public_key')).toBe(true);
    expect(hasScope(['user'], 'user:email')).toBe(true);
  });

  it('refuses a broader scope than the one granted', () => {
    expect(hasScope(['public_repo'], 'repo')).toBe(false);
    expect(hasScope(['read:org'], 'write:org')).toBe(false);
    expect(hasScope([], 'repo')).toBe(false);
  });
});

describe('grantableScopes', () => {
  it('keeps the known scopes gh asks for and drops the rest', () => {
    expect(grantableScopes('repo read:org gist workflow codespace')).toEqual(['repo', 'read:org', 'gist']);
    expect(grantableScopes('')).toEqual([]);
  });
});

describe('scopesOfKey', () => {
  it('reads the scopes a key was granted', () => {
    expect(scopesOfKey({ scopes: ['repo', 'read:org'] })).toEqual(['repo', 'read:org']);
  });

  it('gives a key made in Ghost, which has no scopes, every scope', () => {
    expect(scopesOfKey(null)).toEqual(KNOWN_SCOPES);
    expect(scopesOfKey({})).toEqual(KNOWN_SCOPES);
  });
});
```

Run: `bunx vitest run src/lib/github/scopes.spec.ts`. Expected: FAIL, `hasScope` not exported.

- [ ] **Step 2: Implement `scopes.ts`**

Replace `apps/api/src/lib/github/scopes.ts`:

```ts
/** The GitHub OAuth scopes Ghost recognizes. gh checks `repo` and `read:org` on login; the rest are granted so tools that ask for them keep working. */
export const KNOWN_SCOPES = [
  'repo',
  'public_repo',
  'read:org',
  'write:org',
  'admin:org',
  'user',
  'read:user',
  'user:email',
  'admin:public_key',
  'write:public_key',
  'read:public_key',
  'delete_repo',
  'gist',
] as const;

export type Scope = (typeof KNOWN_SCOPES)[number];

/** What each scope also grants, as on GitHub. */
const IMPLIES: Partial<Record<Scope, readonly Scope[]>> = {
  repo: ['public_repo'],
  'admin:org': ['write:org', 'read:org'],
  'write:org': ['read:org'],
  'admin:public_key': ['write:public_key', 'read:public_key'],
  'write:public_key': ['read:public_key'],
  user: ['read:user', 'user:email'],
};

export function hasScope(granted: readonly string[], needed: Scope) {
  return granted.some((scope) => scope === needed || IMPLIES[scope as Scope]?.includes(needed));
}

/** The known scopes in a space-separated OAuth `scope` request, in order; unknown ones are dropped, so gh asking for one Ghost lacks still logs in. */
export function grantableScopes(requested: string) {
  return requested.split(/\s+/).filter((scope): scope is Scope => (KNOWN_SCOPES as readonly string[]).includes(scope));
}

/** A key's granted scopes. Keys made in Ghost carry none and hold every scope, as Ghost keys always have. */
export function scopesOfKey(permissions: Record<string, string[]> | null | undefined): readonly string[] {
  return permissions?.scopes ?? KNOWN_SCOPES;
}
```

Run the unit test. Expected: PASS.

- [ ] **Step 3: Harness helper for a scoped key**

Append to `apps/api/test/harness.ts`:

```ts
/** An API key holding only `scopes`, as the device flow mints them. */
export async function scopedKey(app: INestApplication, userId: string, scopes: string[]) {
  const auth = app.get<AuthService<Auth>>(AuthService).api;
  const { key } = await auth.createApiKey({ body: { userId, permissions: { scopes } } });
  return key;
}
```

- [ ] **Step 4: Failing e2e**

`apps/api/test/github-scopes.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub scopes', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghscope${Date.now()}`;

  beforeAll(async () => {
    ({ app } = await startApp());
    owner = await signUp(app, username);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports a scoped key its own scopes, and a Ghost key every scope', async () => {
    const key = await scopedKey(app, owner.userId, ['read:org', 'gist']);
    const scoped = await request(app.getHttpServer()).get('/api/v3/').set('authorization', `token ${key}`).expect(200);
    expect(scoped.headers['x-oauth-scopes']).toBe('read:org, gist');
    const full = await request(app.getHttpServer()).get('/api/v3/').set('authorization', `token ${owner.key}`).expect(200);
    expect(full.headers['x-oauth-scopes']).toContain('repo');
  });

  it("never lets an API key into Ghost's own API", async () => {
    const key = await scopedKey(app, owner.userId, ['repo']);
    await request(app.getHttpServer()).get('/api/notifications').set('authorization', `Bearer ${key}`).expect(401);
    await request(app.getHttpServer()).get('/api/notifications').set('x-api-key', key).expect(401);
  });
});
```

Run: `$E2E test/github-scopes.e2e-spec.ts`. Expected: the first case FAILS (`x-oauth-scopes` lists every scope). The second PASSES already: it pins the fact that keys never reach Ghost's own API.

- [ ] **Step 5: Middleware reads the key's scopes**

In `github-auth.middleware.ts`, replace the `ALL_SCOPES` import with `import { KNOWN_SCOPES, scopesOfKey } from '../../lib/github/scopes.js';`, and change `fromKey` and `fromSession`:

```ts
  private async fromKey(key: string): Promise<GithubViewer | null> {
    const { valid, key: apiKey } = await this.auth.api.verifyApiKey({ body: { key } });
    return valid && apiKey ? { userId: apiKey.referenceId, scopes: scopesOfKey(apiKey.permissions) } : null;
  }

  private async fromSession(req: GithubRequest): Promise<GithubViewer | null> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return session ? { userId: session.user.id, scopes: KNOWN_SCOPES } : null;
  }
```

`grep -rn ALL_SCOPES apps/api` must print nothing afterwards.

- [ ] **Step 6: Run, then commit**

Run: `$E2E test/github-scopes.e2e-spec.ts test/github-rest.e2e-spec.ts`, then `bunx vitest run src/lib/github`. Expected: PASS.

```bash
git add apps/api/src/lib/github/scopes.ts apps/api/src/lib/github/scopes.spec.ts apps/api/src/github/auth/github-auth.middleware.ts apps/api/test/harness.ts apps/api/test/github-scopes.e2e-spec.ts
git commit -m "api: give API keys GitHub scopes and report them in X-OAuth-Scopes"
```

---

### Task 2: Enforce scopes on GraphQL and REST

**Files:**
- Create: `apps/api/src/github/auth/require-scope.ts`
- Modify: `apps/api/src/lib/github/github.errors.ts`, `apps/api/src/github/rest/github-rest.filter.ts`
- Modify: `repository.resolver.ts` (`repository`, `load`), every caller of `RepositoryResolver.load`, `issue-mutations.resolver.ts`, `repository-mutations.resolver.ts`, `repos.controller.ts`, `users.controller.ts`
- Modify: `apps/api/test/github-scopes.e2e-spec.ts`

**Interfaces:**
- Consumes `hasScope`, `Scope` (Task 1).
- Produces `InsufficientScopesError(field: string, accepted: readonly Scope[], granted: readonly string[])`, with `readonly accepted` and status 403.
- Produces `requireScope(viewer: GithubViewer, field: string, ...anyOf: Scope[]): void` and `requireWriteScope(viewer: GithubViewer, field: string, repository: { isPrivate: boolean }): void`.
- Changes `RepositoryResolver.load(repositoryId: string, viewer: GithubViewer | null)`. It was `requesterId?: string`. Every caller passes the viewer it has.

- [ ] **Step 1: Failing e2e cases**

In `github-scopes.e2e-spec.ts`, add a GraphQL helper beside `username`, and create two repositories at the end of `beforeAll`:

```ts
  const graphql = (query: string, variables: object, token: string) =>
    request(app.getHttpServer()).post('/api/graphql').set('authorization', `token ${token}`).send({ query, variables });
```

```ts
    for (const [name, visibility] of [['public-repo', 'public'], ['secret-repo', 'private']]) {
      await request(app.getHttpServer()).post('/api/repositories').set('cookie', owner.cookie).send({ name, visibility }).expect(201);
    }
```

Then append the cases:

```ts
  it('hides a private repository from a key without repo, and shows it to one with repo', async () => {
    const publicOnly = await scopedKey(app, owner.userId, ['public_repo', 'read:org']);
    const hidden = await graphql('query($o: String!) { repository(owner: $o, name: "secret-repo") { name } }', { o: username }, publicOnly).expect(200);
    expect(hidden.body.errors[0]).toMatchObject({ type: 'NOT_FOUND' });
    await request(app.getHttpServer()).get(`/api/v3/repos/${username}/secret-repo`).set('authorization', `token ${publicOnly}`).expect(404);
    const full = await scopedKey(app, owner.userId, ['repo']);
    const shown = await graphql('query($o: String!) { repository(owner: $o, name: "secret-repo") { name } }', { o: username }, full).expect(200);
    expect(shown.body.data.repository).toEqual({ name: 'secret-repo' });
  });

  it('lets public_repo write to a public repository and refuses a key with neither', async () => {
    const repo = await graphql('query($o: String!) { repository(owner: $o, name: "public-repo") { id } }', { o: username }, owner.key).expect(200);
    const repositoryId = repo.body.data.repository.id;
    const create = (token: string) => graphql('mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { title } } }', { input: { repositoryId, title: 'Scoped' } }, token).expect(200);
    const allowed = await create(await scopedKey(app, owner.userId, ['public_repo']));
    expect(allowed.body.data.createIssue.issue).toEqual({ title: 'Scoped' });
    const refused = await create(await scopedKey(app, owner.userId, ['read:org']));
    expect(refused.body.errors[0]).toMatchObject({ type: 'FORBIDDEN', message: expect.stringContaining("The 'createIssue' field requires one of the following scopes: ['repo', 'public_repo']") });
  });

  it('answers a REST call without its scope with 403 and X-Accepted-OAuth-Scopes', async () => {
    const key = await scopedKey(app, owner.userId, ['repo']);
    const response = await request(app.getHttpServer()).get('/api/v3/user/keys').set('authorization', `token ${key}`).expect(403);
    expect(response.headers['x-accepted-oauth-scopes']).toBe('read:public_key');
  });

  it('refuses creating a private repository with public_repo only', async () => {
    const key = await scopedKey(app, owner.userId, ['public_repo']);
    await request(app.getHttpServer()).post('/api/v3/user/repos').set('authorization', `token ${key}`).send({ name: 'scoped-private', private: true }).expect(403);
    await request(app.getHttpServer()).post('/api/v3/user/repos').set('authorization', `token ${key}`).send({ name: 'scoped-public' }).expect(201);
  });
```

Run: `$E2E test/github-scopes.e2e-spec.ts`. Expected: these four FAIL.

- [ ] **Step 2: The error and the guard functions**

Append to `apps/api/src/lib/github/github.errors.ts`:

```ts
/** GitHub's missing-scope refusal; `accepted` becomes REST's X-Accepted-OAuth-Scopes. */
export class InsufficientScopesError extends DomainError {
  readonly status = HttpStatus.FORBIDDEN;

  constructor(
    field: string,
    readonly accepted: readonly string[],
    granted: readonly string[],
  ) {
    super(
      `Your token has not been granted the required scopes to execute this query. The '${field}' field requires one of the following scopes: [${accepted.map((scope) => `'${scope}'`).join(', ')}], but your token has only been granted the: [${granted.map((scope) => `'${scope}'`).join(', ')}] scopes.`,
    );
  }
}
```

`apps/api/src/github/auth/require-scope.ts`:

```ts
import { InsufficientScopesError } from '../../lib/github/github.errors.js';
import { hasScope, type Scope } from '../../lib/github/scopes.js';
import type { GithubViewer } from './github-request.js';

/** Refuses unless the viewer's token holds one of `anyOf`; `field` names the GraphQL field or REST route in GitHub's message. */
export function requireScope(viewer: GithubViewer, field: string, ...anyOf: Scope[]) {
  if (!anyOf.some((scope) => hasScope(viewer.scopes, scope))) throw new InsufficientScopesError(field, anyOf, viewer.scopes);
}

/** A write to a repository needs `repo`, or `public_repo` when the repository is public. */
export function requireWriteScope(viewer: GithubViewer, field: string, repository: { isPrivate: boolean }) {
  if (repository.isPrivate) requireScope(viewer, field, 'repo');
  else requireScope(viewer, field, 'repo', 'public_repo');
}
```

- [ ] **Step 3: REST filter sets the header**

In `github-rest.filter.ts`, before `host.switchToHttp()…json(…)`:

```ts
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof InsufficientScopesError) response.setHeader('X-Accepted-OAuth-Scopes', exception.accepted.join(', '));
    response.status(status).json({ message, documentation_url: DOCUMENTATION_URL });
```

and import `InsufficientScopesError` from `../../lib/github/github.errors.js`.

- [ ] **Step 4: Private reads need `repo`**

In `RepositoryResolver`, the scope check goes where both entry points meet. Change `load` and `repository`:

```ts
  async repository(@Args('owner') owner: string, @Args('name') name: string, @Viewer() viewer: GithubViewer | null) {
    const row = await authorizeOrNotFound(this.access, { owner, name, requesterId: viewer?.userId });
    // A token without `repo` cannot see private repositories at all, as on GitHub: they read as missing, not forbidden.
    if (row.visibility === 'private' && viewer && !hasScope(viewer.scopes, 'repo')) throw new CouldNotResolveError(`Could not resolve to a Repository with the name '${owner}/${name}'.`);
    return this.toNode(row.id, row);
  }

  async load(repositoryId: string, viewer: GithubViewer | null) {
    const row = await this.access.authorizeById({ repositoryId, requesterId: viewer?.userId });
    if (row.visibility === 'private' && viewer && !hasScope(viewer.scopes, 'repo')) throw new CouldNotResolveError(`Could not resolve to a node with the global id of '${encodeNodeId('Repository', repositoryId)}'`);
    return this.toNode(repositoryId, row);
  }
```

Then update every caller (`grep -rn "\.load(" apps/api/src/github | grep -v loaders`) to pass the viewer instead of a user id:

- `repository.resolver.ts` `parent`: `orNull(this.load(repository.parentGhostId, viewer))`
- `issue.resolver.ts` `repository`: `this.repositories.load(issue.repositoryGhostId, viewer)`
- `viewer.resolver.ts` `lookup` and `issueById`: pass `req.githubViewer`. Change `issueById(issueId, viewer: GithubViewer | null)` and give `fromRepository` `viewer?.userId`.
- `issue-mutations.resolver.ts` `repositoryFor` / `issueRef`: pass the `viewer` (non-null after `require`). Change their parameter from `userId` to `viewer: GithubViewer`.
- `repository-mutations.resolver.ts`: `this.repositoryNodes.load(created.id, viewer)`
- `repos.controller.ts` `create`: `this.repositoryNodes.load(created.id, viewer)`

- [ ] **Step 5: Writes need `repo` or `public_repo`**

In `issue-mutations.resolver.ts`, every mutation calls `requireWriteScope` once it knows the repository:

- `createIssue`: after `repositoryFor`, `requireWriteScope(viewer, 'createIssue', repository);`
- `updateIssue`, `closeIssue`, `reopenIssue`, `addComment`, and the label and assignee mutations: after `issueRef`, `requireWriteScope(viewer, '<mutationName>', repository);` with the GraphQL field name (`updateIssue`, `closeIssue`, …).

`require(viewer, …)` returns the user id today. Change it to return the viewer, so the functions above can receive it:

```ts
  private require(viewer: GithubViewer | null, mutation: string) {
    if (!viewer) throw new GithubForbiddenError(`You must be signed in to run ${mutation}.`);
    return viewer;
  }
```

and use `viewer.userId` where the old code used `userId`.

`repository-mutations.resolver.ts` `createRepository`, after the signed-in check: `requireWriteScope(viewer, 'createRepository', { isPrivate: input.visibility !== RepositoryVisibility.PUBLIC });`

`repos.controller.ts` `create`, after computing `visibility`: `requireWriteScope(viewer, 'POST /user/repos', { isPrivate: visibility === 'private' });`

`users.controller.ts`: `keys` calls `requireScope(viewer, 'GET /user/keys', 'read:public_key')` after the signed-in check. `addKey` calls `requireScope(viewer, 'POST /user/keys', 'write:public_key')`.

- [ ] **Step 6: Run, then commit**

Run: `$E2E test/github-scopes.e2e-spec.ts test/github-graphql.e2e-spec.ts test/github-rest.e2e-spec.ts`, then `bunx vitest run src/lib/github src/github`. Expected: PASS. The earlier suites use Ghost keys, which hold every scope, so they are unchanged.

```bash
git add apps/api/src apps/api/test
git commit -m "api: enforce GitHub scopes on the compat GraphQL and REST APIs"
```

---

### Task 3: Scopes over git

**Files:**
- Modify: `apps/api/src/git/middleware/git-basic-auth/git-basic-auth.middleware.ts`, its `.spec.ts`

**Interfaces:**
- Consumes `hasScope`, `scopesOfKey` (Task 1).
- `resolveKey` additionally returns `scopes: readonly string[] | null`. It is null for anonymous requests and LFS tokens, which are already scoped to one repository.

- [ ] **Step 1: Failing unit cases**

In the spec's `harness`, let `authorize` resolve `{ id: 'repo_1', visibility: 'private' }` by default. Then add:

```ts
  it('refuses a key without repo on a private repository, and a read-only scope on a push', async () => {
    const publicOnly = harness({
      verify: { valid: true, key: { id: 'key_1', referenceId: 'user_owner', permissions: { scopes: ['public_repo'] } } },
    });
    await publicOnly.run({ headers: { authorization: basic('x', 'ghost_pat_k') } });
    expect(publicOnly.next).toHaveBeenCalledWith(expect.any(RepositoryNotFoundError));

    const readOrg = harness({
      verify: { valid: true, key: { id: 'key_1', referenceId: 'user_owner', permissions: { scopes: ['read:org'] } } },
      authorize: vi.fn().mockResolvedValue({ id: 'repo_1', visibility: 'public' }),
    });
    await readOrg.run({ headers: { authorization: basic('x', 'ghost_pat_k') }, query: { service: 'git-receive-pack' } });
    expect(readOrg.next).toHaveBeenCalledWith(expect.any(RepositoryForbiddenError));
  });

  it('lets public_repo push to a public repository, and a Ghost key do anything', async () => {
    const publicOnly = harness({
      verify: { valid: true, key: { id: 'key_1', referenceId: 'user_owner', permissions: { scopes: ['public_repo'] } } },
      authorize: vi.fn().mockResolvedValue({ id: 'repo_1', visibility: 'public' }),
    });
    await publicOnly.run({ headers: { authorization: basic('x', 'ghost_pat_k') }, query: { service: 'git-receive-pack' } });
    expect(publicOnly.next).toHaveBeenCalledWith();

    const ghost = harness();
    await ghost.run({ headers: { authorization: basic('x', 'ghost_pat_k') }, query: { service: 'git-receive-pack' } });
    expect(ghost.next).toHaveBeenCalledWith();
  });
```

Import `RepositoryNotFoundError` from `../../../lib/repositories/repositories.errors.js` and `RepositoryForbiddenError` from `../../../lib/repositories/access/repository-access.errors.js`.

Run: `bunx vitest run src/git/middleware/git-basic-auth`. Expected: the two new cases FAIL.

- [ ] **Step 2: Implement**

In `resolveKey`, return the key's scopes: `{ actor: { userId: apiKey.referenceId }, apiKeyId: apiKey.id, scopes: scopesOfKey(apiKey.permissions) }`. Every other return gets `scopes: null`. In `use`, after `req.repository = await this.access.authorize(…)` and before the LFS scope check:

```ts
      // A scoped token reads private repositories only with `repo`, and pushes with `repo` or, to a public repository, `public_repo`. Unreadable reads as missing, as on GitHub.
      if (scopes) {
        const isPrivate = req.repository.visibility === 'private';
        if (isPrivate && !hasScope(scopes, 'repo')) throw new RepositoryNotFoundError();
        if (isPush && !hasScope(scopes, isPrivate ? 'repo' : 'public_repo')) throw new RepositoryForbiddenError();
      }
```

Destructure `scopes` alongside `actor`, `apiKeyId`, `scope`. Both errors already flow to `next(error)` through the existing `catch`.

- [ ] **Step 3: Run, then commit**

Run: `bunx vitest run src/git`, then `$E2E test/lfs.e2e-spec.ts test/pull-refs.e2e-spec.ts` (they push with Ghost keys). Expected: PASS.

```bash
git add apps/api/src/git/middleware/git-basic-auth
git commit -m "api: enforce GitHub scopes on git over HTTP"
```

---

### Task 4: The device flow at GitHub's paths

**Files:**
- Modify: `packages/db/src/schema/auth.ts` (`deviceCode` table), then `bun run db:generate` from `packages/db`
- Modify: `apps/api/src/lib/auth.ts` (plugin, `RESERVED_NAMES`), `apps/api/src/app.setup.ts`
- Create: `apps/api/src/lib/github/oauth-apps.ts`
- Create (via `bunx nest g module github/oauth` and `bunx nest g controller github/oauth`): `apps/api/src/github/oauth/oauth.module.ts`, `oauth.controller.ts`, `oauth.controller.spec.ts`
- Create: `apps/api/src/github/oauth/oauth-response.ts`
- Create: `apps/api/test/github-oauth.e2e-spec.ts`

**Interfaces:**
- Consumes `grantableScopes` (Task 1).
- Produces `GH_CLI_APP = { clientId: '178c6fc778ccc68e1d6a', name: 'GitHub CLI' }` and `oauthAppOf(clientId: string): { clientId: string; name: string } | null`.
- Produces `OAUTH_ROUTES` (the two `/login/...` routes), excluded from the `/api` prefix.
- Produces HTTP `POST /login/device/code` and `POST /login/oauth/access_token` as described in Facts.

- [ ] **Step 1: Failing e2e cases**

`apps/api/test/github-oauth.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

const GH = '178c6fc778ccc68e1d6a';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

describe.skipIf(!hasBackends)('GitHub OAuth device flow', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  const username = `ghoauth${Date.now()}`;
  const api = () => request(app.getHttpServer());
  const requestCode = (scope = 'repo read:org gist workflow') => api().post('/login/device/code').type('form').send({ client_id: GH, scope });
  const poll = (deviceCode: string, clientId = GH) => api().post('/login/oauth/access_token').type('form').send({ client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT });
  const form = (text: string) => Object.fromEntries(new URLSearchParams(text));
  const decide = async (userCode: string, decision: 'approve' | 'deny') => {
    await api().get('/api/auth/device').query({ user_code: userCode }).set('cookie', owner.cookie).expect(200);
    await api().post(`/api/auth/device/${decision}`).set('cookie', owner.cookie).send({ userCode }).expect(200);
  };

  beforeAll(async () => {
    ({ app } = await startApp({ WEB_APP_URL: 'https://web.example' }));
    owner = await signUp(app, username);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('hands gh a device code, form-encoded, with the web /device page to visit', async () => {
    const response = await requestCode().expect(200);
    expect(response.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
    const code = form(response.text);
    expect(code).toMatchObject({ verification_uri: 'https://web.example/device', interval: '5', expires_in: '1800' });
    expect(code.user_code).toMatch(/^\w+$/);
    expect(code.device_code).toBeTruthy();
  });

  it('answers JSON when asked, and refuses an unknown client so gh does not loop', async () => {
    const json = await requestCode().set('accept', 'application/json').expect(200);
    expect(json.body).toMatchObject({ verification_uri: 'https://web.example/device', interval: 5 });
    await api().post('/login/device/code').type('form').send({ client_id: 'nope', scope: 'repo' }).expect(400);
  });

  it('answers authorization_pending before approval, and access_denied after a deny', async () => {
    const pending = form((await requestCode().expect(200)).text);
    expect(form((await poll(pending.device_code)).text)).toMatchObject({ error: 'authorization_pending' });

    const denied = form((await requestCode().expect(200)).text);
    await decide(denied.user_code, 'deny');
    expect(form((await poll(denied.device_code)).text)).toMatchObject({ error: 'access_denied' });
  });

  it('mints a ghost_pat_ key with the known scopes gh asked for, never the session', async () => {
    const code = form((await requestCode().expect(200)).text);
    await decide(code.user_code, 'approve');
    expect(form((await poll(code.device_code, 'someone-else')).text)).toMatchObject({ error: 'invalid_grant' });
    const token = form((await poll(code.device_code)).text);
    expect(token).toMatchObject({ token_type: 'bearer', scope: 'repo,read:org,gist' });
    expect(token.access_token).toMatch(/^ghost_pat_/);
    const status = await api().get('/api/v3/').set('authorization', `token ${token.access_token}`).expect(200);
    expect(status.headers['x-oauth-scopes']).toBe('repo, read:org, gist');
    expect(form((await poll(code.device_code)).text).error).toBeTruthy();
  });
});
```

The approve case polls only once, right after approval, so the plugin's 5-second `slow_down` window never triggers.

Run: `$E2E test/github-oauth.e2e-spec.ts`. Expected: FAIL (404 on `/login/device/code`).

- [ ] **Step 2: The `deviceCode` table**

Append to `packages/db/src/schema/auth.ts`, after `apikey`:

```ts
/** Better Auth's device-authorization codes; `gh auth login --web` polls one until the user approves it on /device. */
export const deviceCode = pgTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (table) => [
    uniqueIndex("device_code_device_code_uidx").on(table.deviceCode),
    uniqueIndex("device_code_user_code_uidx").on(table.userCode),
  ],
);
```

From `packages/db`: `bun run db:generate`. Expected: a new `drizzle/0050_*.sql` creating `device_code`. Read it. It must create only that table and its indexes.

- [ ] **Step 3: The app constant, the plugin, reserved names**

`apps/api/src/lib/github/oauth-apps.ts`:

```ts
/** gh's OAuth app, the same client id on every GitHub host. Plan 3 replaces this constant with a registry of apps users create. */
export const GH_CLI_APP = { clientId: '178c6fc778ccc68e1d6a', name: 'GitHub CLI' } as const;

export function oauthAppOf(clientId: string) {
  return clientId === GH_CLI_APP.clientId ? GH_CLI_APP : null;
}
```

In `apps/api/src/lib/auth.ts`:

- Add `'device'` and `'login'` to `RESERVED_NAMES`. `/device` is the web page and `/login/...` the OAuth endpoints. An existing account under either name keeps working, but its profile page is shadowed.
- Import `deviceAuthorization` from `better-auth/plugins` and `oauthAppOf` from `./github/oauth-apps.js`. Append to `plugins`:

```ts
      deviceAuthorization({
        verificationUri: `${config.webAppUrl ?? ''}/device`,
        validateClient: (clientId) => oauthAppOf(clientId) !== null,
      }),
```

- [ ] **Step 4: Root routes and the response shape**

In `apps/api/src/app.setup.ts`, define the routes and exclude them:

```ts
/** GitHub's OAuth endpoints, which gh calls at the host root rather than under /api. */
export const OAUTH_ROUTES = [
  { path: 'login/device/code', method: RequestMethod.POST },
  { path: 'login/oauth/access_token', method: RequestMethod.POST },
];
```

`app.setGlobalPrefix('/api', { exclude: [...GIT_TRANSPORT_ROUTES, ...OAUTH_ROUTES] });` Import `RequestMethod` from `@nestjs/common`. Also add `OAUTH_ROUTES` to the exclude list in `apps/api/scripts/generate-openapi.ts`.

`apps/api/src/github/oauth/oauth-response.ts`:

```ts
import type { Request, Response } from 'express';

/** GitHub answers its OAuth endpoints form-encoded unless the client asks for JSON; gh's client reads either. */
export function sendOAuth(req: Request, res: Response, status: number, body: Record<string, string | number>) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  if (/application\/json/.test(req.headers.accept ?? '')) return res.json(body);
  res.type('application/x-www-form-urlencoded').send(new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString());
}
```

- [ ] **Step 5: The controller**

From `apps/api`: `bunx nest g module github/oauth` and `bunx nest g controller github/oauth`. Import `OauthModule` in `GithubModule`.

`oauth.controller.ts`:

```ts
import { type Database, schema } from '@ghost/db';
import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowAnonymous, AuthService } from '@thallesp/nestjs-better-auth';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';

import { DATABASE } from '../../database/database.module.js';
import type { Auth } from '../../lib/auth.js';
import { oauthAppOf } from '../../lib/github/oauth-apps.js';
import { grantableScopes } from '../../lib/github/scopes.js';
import { sendOAuth } from './oauth-response.js';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** GitHub's OAuth device flow at its own paths, translated onto Better Auth's deviceAuthorization plugin. */
@Controller('login')
@ApiExcludeController()
@AllowAnonymous()
export class OauthController {
  constructor(
    private readonly auth: AuthService<Auth>,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Post('device/code')
  async deviceCode(@Body() body: { client_id?: string; scope?: string }, @Req() req: Request, @Res() res: Response) {
    if (!body.client_id || !oauthAppOf(body.client_id)) return sendOAuth(req, res, 400, { error: 'unauthorized_client', error_description: 'Unknown client_id' });
    const code = await this.auth.api.deviceCode({ body: { client_id: body.client_id, scope: grantableScopes(body.scope ?? '').join(' ') } });
    sendOAuth(req, res, 200, {
      device_code: code.device_code,
      user_code: code.user_code,
      verification_uri: code.verification_uri,
      expires_in: code.expires_in,
      interval: code.interval,
    });
  }

  @Post('oauth/access_token')
  async accessToken(@Body() body: { client_id?: string; device_code?: string; grant_type?: string }, @Req() req: Request, @Res() res: Response) {
    // ponytail: the device grant only; plan 3 adds grant_type=authorization_code for user-registered apps.
    if (body.grant_type !== DEVICE_GRANT || !body.client_id || !body.device_code) return sendOAuth(req, res, 400, { error: 'unsupported_grant_type' });
    const app = oauthAppOf(body.client_id);
    if (!app) return sendOAuth(req, res, 400, { error: 'invalid_client' });

    let granted: { access_token: string; scope: string };
    try {
      granted = await this.auth.api.deviceToken({ body: { grant_type: DEVICE_GRANT, device_code: body.device_code, client_id: body.client_id } });
    } catch (error) {
      if (!(error instanceof APIError)) throw error;
      // GitHub answers pending, slow_down, expired and denied with 200 and `error` in the body; gh reads the body, not the status.
      const { error: code, error_description } = error.body as { error?: string; error_description?: string };
      return sendOAuth(req, res, 200, { error: code ?? 'invalid_grant', ...(error_description && { error_description }) });
    }

    // The plugin answers with a browser session; gh gets a scoped API key instead, and the session is ended.
    const [session] = await this.db.delete(schema.session).where(eq(schema.session.token, granted.access_token)).returning({ userId: schema.session.userId });
    if (!session) return sendOAuth(req, res, 200, { error: 'invalid_grant' });
    const scopes = grantableScopes(granted.scope);
    const { key } = await this.auth.api.createApiKey({
      body: { userId: session.userId, name: app.name, permissions: { scopes }, metadata: { oauthClientId: app.clientId } },
    });
    sendOAuth(req, res, 200, { access_token: key, token_type: 'bearer', scope: scopes.join(',') });
  }
}
```

If `APIError` is not exported from `better-auth/api` in 1.7.2, import it from `better-call`. `auth.ts` already throws `APIError`; use the same import it uses.

Generated `oauth.controller.spec.ts`: provide `{ provide: AuthService, useValue: {} }` and `{ provide: DATABASE, useValue: {} }`.

- [ ] **Step 6: Run, then commit**

Run: `$E2E test/github-oauth.e2e-spec.ts test/github-scopes.e2e-spec.ts`, then `bunx vitest run src/lib/github src/github`. Expected: PASS.

If the JSON case fails because `@thallesp/nestjs-better-auth`'s body parsers do not cover root routes, the form-encoded cases will fail too. Mount `express.urlencoded({ extended: false })` for `OAUTH_ROUTES` only in `OauthModule.configure`, and say so in a comment.

```bash
git add packages/db apps/api/src apps/api/scripts apps/api/test
git commit -m "api: serve GitHub's OAuth device flow, minting scoped keys for gh"
```

---

### Task 5: The web `/device` page

**Files:**
- Modify: `apps/web/src/lib/auth-client.ts`
- Create: `apps/web/src/app/device/layout.tsx`, `page.tsx`, `device-form.tsx`

**Interfaces:**
- Consumes the plugin's `GET /api/auth/device?user_code=` → `{ user_code, status, client_id, scope }`, `POST /api/auth/device/approve|deny { userCode }`.
- Consumes `GH_CLI_APP.name` by duplicating the one name the web shows: `{ '178c6fc778ccc68e1d6a': 'GitHub CLI' }`. Plan 3 replaces it with the app registry.

- [ ] **Step 1: Client plugin**

In `auth-client.ts`, import `deviceAuthorizationClient` from `better-auth/client/plugins` and add `deviceAuthorizationClient()` to `plugins`.

- [ ] **Step 2: Layout and page**

`apps/web/src/app/device/layout.tsx`:

```tsx
export { SignedInLayout as default } from "@/components/auth/signed-in-layout";
```

`apps/web/src/app/device/page.tsx`:

```tsx
import type { Metadata } from "next";

import { DeviceForm } from "./device-form";

export const metadata: Metadata = { title: "Device activation" };

export default async function DevicePage({ searchParams }: PageProps<"/device">) {
  const { user_code } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-12">
      <h1 className="text-xl font-semibold">Device activation</h1>
      <DeviceForm initialCode={typeof user_code === "string" ? user_code : ""} />
    </div>
  );
}
```

- [ ] **Step 3: The form**

`apps/web/src/app/device/device-form.tsx`, a client component with three states (enter code, review, done):

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const APP_NAMES: Record<string, string> = { "178c6fc778ccc68e1d6a": "GitHub CLI" };

type Request = { userCode: string; app: string; scopes: string[] };

export function DeviceForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [request, setRequest] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  async function lookUp() {
    setError(null);
    const userCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const { data, error } = await authClient.device({ query: { user_code: userCode } });
    if (error || !data) return setError(error?.message ?? "That code is not valid or has expired.");
    if (data.status !== "pending") return setError("That code has already been used.");
    const clientId = (data as { client_id?: string }).client_id ?? "";
    const scope = (data as { scope?: string }).scope ?? "";
    setRequest({ userCode, app: APP_NAMES[clientId] ?? clientId, scopes: scope.split(" ").filter(Boolean) });
  }

  async function decide(decision: "approve" | "deny") {
    if (!request) return;
    const { error } = decision === "approve"
      ? await authClient.device.approve({ userCode: request.userCode })
      : await authClient.device.deny({ userCode: request.userCode });
    if (error) return setError(error.message ?? "Something went wrong.");
    setDone(decision === "approve" ? "approved" : "denied");
  }

  if (done) return <p>{done === "approved" ? "Device approved. You can return to your terminal." : "Request denied."}</p>;

  if (request)
    return (
      <div className="flex flex-col gap-4">
        <p><strong>{request.app}</strong> is asking to access your account with these scopes:</p>
        <ul className="list-disc pl-6">{request.scopes.map((scope) => <li key={scope}><code>{scope}</code></li>)}</ul>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={() => decide("approve")}>Authorize</Button>
          <Button variant="outline" onClick={() => decide("deny")}>Deny</Button>
        </div>
      </div>
    );

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void lookUp(); }}>
      <label htmlFor="user-code">Enter the code shown in your terminal</label>
      <Input id="user-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit">Continue</Button>
    </form>
  );
}
```

Check the generated client method names before relying on them. Run `bun run check-types` from `apps/web`. If the client exposes `authClient.device.verify` instead of `authClient.device`, use what the types offer.

- [ ] **Step 4: Check by hand, then commit**

From the root: `bun run check-types` and `bun run lint` (the web lint errors already on `main` in `components/auth` are not this task's). Start the API and web locally. Run `curl -s -X POST -d client_id=178c6fc778ccc68e1d6a -d scope=repo localhost:3001/login/device/code`, open `/device?user_code=<code>` signed in, and approve. A second `curl … /login/oauth/access_token` with the device code and grant type must return `access_token=ghost_pat_…`.

```bash
git add apps/web/src
git commit -m "web: device activation page for gh auth login --web"
```

---

### Task 6: `gh auth login --web` and `gh auth refresh` against the real CLI

**Files:**
- Modify: `apps/api/test/gh.ts` (`startGh`), `apps/api/test/gh-cli.e2e-spec.ts`

**Interfaces:**
- Produces `startGh(args: string[], options: { configDir: string; token?: string }): { stderrUntil(pattern: RegExp): Promise<RegExpMatchArray>; done: Promise<{ stdout: string; stderr: string; code: number }> }`.

- [ ] **Step 1: Streaming helper**

In `test/gh.ts`, split the env building out of `runGh` into `ghEnv(configDir, token?)`, and add:

```ts
/** Starts gh and lets a test act on its stderr while it runs, as the device flow needs: gh prints the code, then polls. */
export function startGh(args: string[], { configDir, token }: { configDir: string; token?: string }) {
  const child = spawn('gh', args, { env: ghEnv(configDir, token) });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  const waiters: Array<{ pattern: RegExp; resolve: (match: RegExpMatchArray) => void }> = [];
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    for (const waiter of [...waiters]) {
      const match = stderr.match(waiter.pattern);
      if (match) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(match);
      }
    }
  });
  const done = new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 })));
  return {
    stderrUntil: (pattern: RegExp) => new Promise<RegExpMatchArray>((resolve) => {
      const match = stderr.match(pattern);
      if (match) resolve(match);
      else waiters.push({ pattern, resolve });
    }),
    done,
  };
}
```

`runGh` keeps its behavior and uses `ghEnv`.

- [ ] **Step 2: The cases**

Add to `gh-cli.e2e-spec.ts`. Each uses its own config dir, so the token-based cases keep theirs. `api` is the trusting supertest agent from `beforeAll`; hoist it to a `let`.

```ts
  it('logs in through the device flow', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-web-'));
    const login = startGh(['auth', 'login', '--hostname', GH_E2E_HOST!, '--web', '--git-protocol', 'https', '--skip-ssh-key'], { configDir: dir });
    const [, userCode] = await login.stderrUntil(/one-time code: (\S+)/);
    await api.get('/api/auth/device').query({ user_code: userCode.replace('-', '') }).set('cookie', owner.cookie).expect(200);
    await api.post('/api/auth/device/approve').set('cookie', owner.cookie).send({ userCode: userCode.replace('-', '') }).expect(200);
    const result = await login.done;
    expect(result, result.stderr).toMatchObject({ code: 0 });
    const status = await runGh(['auth', 'status', '--hostname', GH_E2E_HOST!], { configDir: dir });
    expect(status.stdout + status.stderr).toMatch(/Token scopes: 'repo', 'read:org', 'gist'/);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('widens scopes with gh auth refresh', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-refresh-'));
    await runGh(['auth', 'login', '--hostname', GH_E2E_HOST!, '--with-token'], { configDir: dir, input: await scopedKey(app, owner.userId, ['repo', 'read:org', 'gist']) });
    const refresh = startGh(['auth', 'refresh', '--hostname', GH_E2E_HOST!, '--scopes', 'admin:public_key'], { configDir: dir });
    const [, userCode] = await refresh.stderrUntil(/one-time code: (\S+)/);
    await api.get('/api/auth/device').query({ user_code: userCode.replace('-', '') }).set('cookie', owner.cookie).expect(200);
    await api.post('/api/auth/device/approve').set('cookie', owner.cookie).send({ userCode: userCode.replace('-', '') }).expect(200);
    expect((await refresh.done).code).toBe(0);
    const status = await runGh(['auth', 'status', '--hostname', GH_E2E_HOST!], { configDir: dir });
    expect(status.stdout + status.stderr).toContain("'admin:public_key'");
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
```

`gh` may print the user code with a hyphen (`ABCD-EFGH`), while the plugin stores it without one. If `GET /api/auth/device` rejects the hyphen-free form, send it as printed. Keep whichever the plugin accepts, and use the same normalization in `device-form.tsx`.

These cases run in CI only, like every `gh` case, because `GH_E2E_HOST` needs port 443.

- [ ] **Step 3: Push and watch CI**

Commit, push, and watch the run as plan 1's Task 17 did. Expected: the two new cases pass. If `gh` prints the code on a different line, adjust `stderrUntil`'s pattern to match its actual output from the CI log.

```bash
git add apps/api/test
git commit -m "api: run gh auth login --web and gh auth refresh in the gh e2e suite"
```

---

### Task 7: Documentation

**Files:**
- Modify: `apps/docs/content/docs/github-compatibility.mdx`, `docs/0040-github-compatibility-is-a-translation-layer.md`, `apps/api/openapi.json` and `apps/web/src/lib/api/v1.d.ts` (regenerated)

- [ ] **Step 1: Compatibility page**

- Setup: add `gh auth login --hostname api.<domain> --web` beside the token login. It opens `<web>/device`.
- Supported commands: add `gh auth login --web`, `gh auth refresh`, `gh auth setup-git`.
- Known differences: replace "Every token is granted every scope `gh` checks for." with "API keys made in Ghost's settings hold every scope. Keys from `gh auth login --web` hold the scopes `gh` asked for that Ghost knows (`repo`, `read:org`, `gist`, …); unknown scopes are dropped."
- Not yet supported: remove `gh auth login --web` and `gh auth refresh`. Add "OAuth apps other than `gh`, and the authorization-code flow."

- [ ] **Step 2: ADR addendum**

Append to ADR 0040 under a new `## Addendum: scopes and the device flow`:

- Keys store GitHub scopes in `permissions.scopes`. Keys without them hold every scope.
- One function decides coverage, with GitHub's implications.
- Private repositories need `repo` and read as missing without it.
- The device flow runs on Better Auth's plugin, behind GitHub's paths at the host root.
- `gh` receives a scoped `ghost_pat_` key, never the plugin's session.
- Rejected: handing out the Better Auth session (a full browser session, for every API), and a separate token table (API keys already verify, rate-limit and revoke).

- [ ] **Step 3: OpenAPI, then commit**

From the root: `bun run openapi`. The OAuth controller is excluded from the document, so expect only scope-related description changes, if any.

```bash
git add apps/docs docs/0040-github-compatibility-is-a-translation-layer.md apps/api/openapi.json apps/web/src/lib/api/v1.d.ts
git commit -m "docs: scopes and the gh device flow"
```
