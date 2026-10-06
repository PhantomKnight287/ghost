# Deploying to Railway

Ghost is a Bun/Turborepo monorepo with two long-running services plus two pieces
of infrastructure:

| Piece            | What it is                   | On Railway                              |
| ---------------- | ---------------------------- | --------------------------------------- |
| `apps/api`       | NestJS + git smart-HTTP      | Service, `apps/api/Dockerfile`          |
| `apps/web`       | Next.js                      | Service, `apps/web/Dockerfile`          |
| Postgres         | Everything except git objects | Railway Postgres database              |
| S3 bucket        | The git object log (WAL)      | External: Cloudflare R2, Tigris, MinIO  |

All of it is declared in `.railway/railway.ts`.

Railway has no S3 product, so the bucket comes from elsewhere. Anything
S3-compatible works — the client uses path-style addressing and region `auto`.

Repository working copies are a **cache** under the API's `TMPDIR`, rebuilt from
the S3 log on demand, so no volume is required. Attaching one to `/tmp` only
saves re-materialisation after a restart.

## 1. Declare the infrastructure

Everything lives in `.railway/railway.ts` — Railway's Infrastructure as Code.
(`railway.json` / `railway.toml` config-as-code is deprecated and stops being
read on 2026-12-01.) The file declares the Postgres database and both services,
including which Dockerfile each one builds and the migration step:

```ts
const api = service("api", {
  source: github(REPO),
  build: { builder: "DOCKERFILE", dockerfilePath: "apps/api/Dockerfile" },
  preDeploy: "node packages/db/dist/migrate.js",
  healthcheck: "/api",
  domains: [API_DOMAIN],
  env: { DATABASE_URL: db.env.DATABASE_URL, /* … */ },
});
```

Open it and change the two things that are yours: `REPO` and `ROOT_DOMAIN`.

Secrets are declared as `preserve()`, which means "keep whatever is already set
on the service". Set those once by hand, and the file never carries a secret.

## 2. Apply it

```sh
npm install -g @railway/cli   # 5.42.1 or newer: the IaC engine ships in the CLI
railway login
railway link                  # create or pick the project
railway config plan           # shows what would change
railway config apply
```

Set the secrets before or right after the first apply, on the `api` service:

```sh
railway variables --service api \
  --set BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --set S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
  --set S3_ACCESS_KEY_ID=... \
  --set S3_SECRET_ACCESS_KEY=...
```

Custom domains are the one thing configuration cannot create — `railway config
apply` rejects them with *"Custom-domain registration is not supported by
Railway configuration"*. Add both in the dashboard, then pull what Railway now
knows:

```sh
railway config pull
```

`railway config plan` on every change, `railway config apply` to commit it.

## 3. What the file already sets

### `api`

| Variable                | Source                                                  |
| ----------------------- | ------------------------------------------------------- |
| `DATABASE_URL`          | referenced from the Postgres resource                    |
| `BETTER_AUTH_URL`       | `https://<API_DOMAIN>`                                   |
| `AUTH_TRUSTED_ORIGINS`  | `https://<WEB_DOMAIN>`                                   |
| `AUTH_COOKIE_DOMAIN`    | `.<ROOT_DOMAIN>` — see *Cookies* below                   |
| `S3_BUCKET`             | `ghost` — **create the bucket yourself**, the app does not |
| `BETTER_AUTH_SECRET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `preserve()`: set by hand |

`PORT` is injected by Railway and the server prefers it over `API_PORT`.

### Commit signing

Merges, squashes, rebases and applied suggestions go out unsigned until `COMMIT_SIGNING_KEY` is set on the `api` service. Generate the key once and keep it: Ghost trusts only the current key, so replacing it unverifies every commit the old one signed.

```bash
gpg --batch --pinentry-mode loopback --passphrase '' --quick-gen-key Ghost ed25519 sign never
gpg --armor --export-secret-keys Ghost | base64 | tr -d '\n'
```

### SSH

The git SSH transport is off until `GIT_SSH_HOST_KEY` is set, so a deployment
without it serves git over HTTP alone and needs nothing else here.

To turn it on:

1. Generate a host key once and keep it. Rotating it makes every client print
   a changed-host-key warning.

   ```bash
   ssh-keygen -t ed25519 -N '' -f ghost_host_key
   base64 -w0 ghost_host_key   # macOS: base64 -i ghost_host_key
   ```

2. Set `GIT_SSH_HOST_KEY` to that base64 blob on the `api` service, and
   `GIT_SSH_PORT` to the port it should listen on. The default is `1031`;
   **2222 is not available**, Railway uses it for its own container SSH.
3. Railway's HTTP proxy cannot carry SSH, so add a **TCP proxy** on the `api`
   service pointing at `GIT_SSH_PORT`:

   ```bash
   bunx railway tcp-proxy create --port 1031 --service api
   bunx railway tcp-proxy list --service api --json
   ```

   Railway answers with a host and a public port of its own. That public port
   is what people put in their clone URL — the container port stays 1031.
4. Set `NEXT_PUBLIC_SSH_CLONE_HOST` on the `web` service to that
   `host:port`, so the repository page offers the SSH clone URL. It is inlined
   at build time, so set it before building.

Tell people the host key's fingerprint — `ssh-keygen -lf ghost_host_key.pub` —
so their first connection has something to compare against.

### Storage limits

Pushed git data, release assets and Git LFS objects are all stored in the same
bucket. These variables on the `api` service limit what each account may store
there, what one release asset may be, and what pull requests may copy into a
base repository. A `storage_limit` row overrides the first three for one
account. Sizes are bytes or binary units (`1073741824`, `1gb`, `500mb`):

| Variable                  | Effect                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| `STORAGE_QUOTA_BYTES`     | Most each account may store outside forks, Git LFS objects aside: a user, or an organization for its repositories. Empty (the default) means unlimited. |
| `FORK_STORAGE_QUOTA_BYTES` | Most each account may store in forks, their Git LFS objects included. Empty means unlimited. |
| `LFS_STORAGE_QUOTA_BYTES` | Most each account may store in Git LFS objects outside forks. Empty means unlimited. |
| `RELEASE_ASSET_MAX_BYTES` | Largest single asset. `2gb` unless set, and never above `5gb`.       |
| `PULL_REF_MAX_BYTES`      | Most one update of a pull request's `refs/pull/<n>/head` may copy into the base repository. Empty means unlimited. |
| `PULL_REF_UNMERGED_MAX_BYTES` | Most one author's unmerged pull requests may hold in base repositories altogether. Empty means unlimited. |

A value the server cannot read stops it at boot rather than silently lifting
the limit. Lowering the quota deletes nothing: an account over it can still
read and delete its files, and cannot upload until it is back under. See
[0025](0025-storage-is-billed-to-the-owning-account.md).

### `web`

| Variable                | Source                          |
| ----------------------- | ------------------------------- |
| `NEXT_PUBLIC_API_URL`   | `https://<API_DOMAIN>`          |

`NEXT_PUBLIC_*` is inlined at **build** time. Railway exposes service variables
to Dockerfile builds only through `ARG`, which `apps/web/Dockerfile` declares —
so the value is picked up automatically, but changing it needs a rebuild, not a
restart.

## 4. Domains and cookies

The browser talks to the API directly, so sessions are only cross-origin-safe
when both services sit under one registrable domain:

- `web` → `ghost.example.com`
- `api` → `api.ghost.example.com`
- `AUTH_COOKIE_DOMAIN` → `.example.com`

`*.up.railway.app` is on the Public Suffix List, so a cookie cannot be shared
across two generated Railway subdomains. **Sign-in will not work on the default
domains.** Add both domains in the dashboard (configuration cannot register
them) and point their DNS at Railway before testing auth. The `ROOT_DOMAIN`
constant in `.railway/railway.ts` only feeds the URL variables.

Clone URLs follow the API domain:

```sh
git clone https://api.ghost.example.com/<user>/<repo>
```

## 5. Migrations

`.railway/railway.ts` runs `node packages/db/dist/migrate.js` as the API's
pre-deploy command, which applies `packages/db/drizzle/*.sql` with the same connection
string as the app. A failed migration fails the deploy and the previous version
stays up.

## Building the images locally

```sh
docker build -f apps/api/Dockerfile -t ghost-api .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.ghost.example.com \
  -t ghost-web .
```

The API image carries the `git` binary — every fetch and push shells out to it.

The web image starts with `HOSTNAME=0.0.0.0`. Next.js' standalone server binds
to whatever `$HOSTNAME` holds, and container runtimes set that to the container
id — a single interface, which answers a published Docker port but refuses the
Railway proxy. The `CMD` sets it at boot so a runtime-injected `HOSTNAME` cannot
win.
