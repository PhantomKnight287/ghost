# Deploying to Railway

Ghost is a Bun/Turborepo monorepo with two long-running services plus two pieces
of infrastructure:

| Piece            | What it is                   | On Railway                              |
| ---------------- | ---------------------------- | --------------------------------------- |
| `apps/api`       | NestJS + git smart-HTTP      | Service, `apps/api/Dockerfile`          |
| `apps/web`       | Next.js                      | Service, `apps/web/Dockerfile`          |
| Postgres         | Everything except git objects | Railway Postgres database              |
| S3 bucket        | The git object log (WAL)      | External: Cloudflare R2, Tigris, MinIO  |

Railway has no S3 product, so the bucket comes from elsewhere. Anything
S3-compatible works — the client uses path-style addressing and region `auto`.

Repository working copies are a **cache** under the API's `TMPDIR`, rebuilt from
the S3 log on demand, so no volume is required. Attaching one to `/tmp` only
saves re-materialisation after a restart.

## 1. Create the project

1. New project → **Deploy from GitHub repo**, pick this repository.
2. Add a **Postgres** database to the project.
3. Delete the service Railway guesses for you, then add two services from the
   same repo: name them `api` and `web`.

## 2. Point each service at its Dockerfile

Both services build from the **repository root** (they need the `@ghost/db`
workspace and `bun.lock`), so leave *Root Directory* empty and instead set, per
service, *Settings → Config-as-code → Config file path*:

- `api` → `railway.api.json`
- `web` → `railway.web.json`

Those files pin the builder, the Dockerfile path, the start command, the health
check, and — for the API — the pre-deploy migration step.

## 3. Environment variables

### `api`

| Variable                | Value                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`          | `${{Postgres.DATABASE_URL}}`                                    |
| `BETTER_AUTH_SECRET`    | 32+ random chars (`openssl rand -base64 32`)                    |
| `BETTER_AUTH_URL`       | Public API URL, e.g. `https://api.ghost.example.com`            |
| `AUTH_TRUSTED_ORIGINS`  | Public web URL, e.g. `https://ghost.example.com`                |
| `AUTH_COOKIE_DOMAIN`    | `.example.com` — see *Cookies* below                            |
| `S3_ENDPOINT`           | e.g. `https://<account>.r2.cloudflarestorage.com`               |
| `S3_ACCESS_KEY_ID`      | from the bucket provider                                        |
| `S3_SECRET_ACCESS_KEY`  | from the bucket provider                                        |
| `S3_BUCKET`             | bucket name — **create it yourself**, the app does not          |

`PORT` is injected by Railway and the server prefers it over `API_PORT`.

### `web`

| Variable                        | Value                                             |
| ------------------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | Public API URL, same as `BETTER_AUTH_URL`         |

`NEXT_PUBLIC_*` is inlined at **build** time, so the web Dockerfile takes it as
a build argument. Set it as a Railway service variable *and* declare it under
*Settings → Build → Build arguments* (`NEXT_PUBLIC_API_URL`), otherwise the
browser bundle keeps pointing at `http://localhost:3001`. Changing it later
requires a rebuild, not just a restart.

## 4. Domains and cookies

The browser talks to the API directly, so sessions are only cross-origin-safe
when both services sit under one registrable domain:

- `web` → `ghost.example.com`
- `api` → `api.ghost.example.com`
- `AUTH_COOKIE_DOMAIN` → `.example.com`

`*.up.railway.app` is on the Public Suffix List, so a cookie cannot be shared
across two generated Railway subdomains. **Sign-in will not work on the default
domains** — add a custom domain to each service before testing auth.

Clone URLs follow the API domain:

```sh
git clone https://api.ghost.example.com/<user>/<repo>
```

## 5. Migrations

`railway.api.json` runs `node packages/db/dist/migrate.js` as the pre-deploy
command, which applies `packages/db/drizzle/*.sql` with the same connection
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
