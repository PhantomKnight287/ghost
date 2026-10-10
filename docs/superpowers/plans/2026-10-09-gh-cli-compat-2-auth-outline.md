# gh CLI compatibility, plan 2 outline: scopes, OAuth apps, device flow

Short list of what plan 2 has to build, in order. The full plan with code and tests is `2026-10-09-gh-cli-compat-2-auth.md`. Spec: `docs/superpowers/specs/2026-10-09-gh-cli-compat-design.md`, section "Auth".

1. **Real scopes on keys.** Store GitHub scopes in the API key's `permissions`. `GithubAuthMiddleware.fromKey` reads them instead of `ALL_SCOPES`. Keys made in Ghost's UI and sessions keep every scope. `X-OAuth-Scopes` reports the real scopes. Done when a key with only `repo` makes `gh auth status` print `repo` alone.
2. **`@RequiresScope()`.** One decorator, checked in the compat layer. Missing scope: 403 with `X-Accepted-OAuth-Scopes` on REST, `FORBIDDEN` on GraphQL. Mutations and `POST /user/repos` need `repo` (or `public_repo` for public repositories). `POST /user/keys` needs `admin:public_key`; `GET /user/keys` needs `read:public_key` or `admin:public_key`.
3. **Git middleware enforces scopes.** A scoped key needs `repo` for private reads and any push to a private repository, and `public_repo` or `repo` to push to a public one. This makes `gh auth setup-git` safe. Git Basic auth with the token already works.
4. **Ghost's own API refuses OAuth-app keys.** A key owned by an OAuth app gets 401 on `/api/*` outside `/api/v3` and `/api/graphql`, because Ghost's own controllers have no scope checks.
5. **OAuth app registry.** Seed `gh` as a built-in app (client id `178c6fc778ccc68e1d6a`, device flow on, not editable). `login` and `device` join `RESERVED_NAMES`, with a migration check that no user or organization holds them.
6. **Device flow at the host root.** `/login/...` joins the global-prefix exclusion next to `GIT_TRANSPORT_ROUTES` and registers before the git routes. `POST /login/device/code` returns `device_code`, `user_code`, `verification_uri` (`<web>/device`), `expires_in`, `interval`; form-encoded by default, JSON on `Accept: application/json`. `POST /login/oauth/access_token` with the device-code grant answers pending and slow-down as HTTP 200 with `error=authorization_pending|slow_down`; on approval it mints a `ghost_pat_` key with the approved scopes and the app id and returns `access_token`, `token_type=bearer`, `scope`. Expired and denied answer `expired_token` and `access_denied`. Done when `gh auth login --hostname H --web` completes in e2e, with the test approving the code through the API.
7. **Web `/device` page.** Signed-in only: enter the user code, see the app and the requested scopes, approve or deny.
8. **`gh auth refresh --scopes …`.** The same device flow with wider scopes; the new token replaces the old one. Likely no new server code once step 6 works; add an e2e case.
9. **Authorization-code flow** for third-party apps: `GET /login/oauth/authorize` redirects to a consent page on the web app, `POST /login/oauth/access_token` with `grant_type=authorization_code` returns a scoped key. `gh` does not need it.
10. **Settings UI.** "OAuth apps" (create, secret shown once, regenerate, device-flow switch) and "Authorized apps" (revoke, which revokes the app's keys).
11. **Docs.** The compatibility page loses `--web` and `refresh` from "Not yet supported". ADR 0040 gets a scopes and OAuth addendum. `bun run openapi` for the new REST routes.

Order: 1-4 work without OAuth; 6 needs 5; 7 and 8 need 6; 9 and 10 can follow later.

Open questions, settled by reading `cli/oauth` and `gh`'s `internal/authflow` before step 6:

- Does `gh` send `Accept: application/json` to `/login/oauth/access_token`?
- Does `gh` use the same client id for GitHub Enterprise Server hosts as for github.com?
