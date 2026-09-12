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
domains.** `.railway/railway.ts` attaches both custom domains through `domains:`;
point their DNS at Railway before testing auth.

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
