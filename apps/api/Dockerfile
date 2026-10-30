# syntax=docker/dockerfile:1
# Built from the repository root: the API depends on the @ghost/db workspace.
#   docker build -f apps/api/Dockerfile .

# Keep in step with apps/zoekt/Dockerfile: the indexer and the webserver share a shard format.
FROM ghcr.io/sourcegraph/zoekt:0.0.0-20260911061844-153817f643cd AS zoekt

FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/learn/package.json apps/learn/package.json
COPY apps/delivery/package.json apps/delivery/package.json
COPY apps/importer/package.json apps/importer/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/languages/package.json packages/languages/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/references/package.json packages/references/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/webhooks/package.json packages/webhooks/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN bun run --filter @ghost/db build \
 && bun run --filter @ghost/languages build \
 && bun run --filter @ghost/permissions build \
 && bun run --filter @ghost/references build \
 && bun run --filter @ghost/templates build \
 && bun run --filter @ghost/webhooks build \
 && bun run --filter @ghost/api build

# A second, clean install: the runtime needs neither the web app's dependencies
# nor the compilers, and pruning in place leaves Bun's package store behind.
FROM oven/bun:1.4.4 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/learn/package.json apps/learn/package.json
COPY apps/delivery/package.json apps/delivery/package.json
COPY apps/importer/package.json apps/importer/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/languages/package.json packages/languages/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/references/package.json packages/references/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/webhooks/package.json packages/webhooks/package.json
RUN bun install --frozen-lockfile --production \
      --filter '@ghost/api' --filter '@ghost/db' --filter '@ghost/languages' \
      --filter '@ghost/permissions' --filter '@ghost/references' --filter '@ghost/templates' --filter '@ghost/webhooks'

FROM node:22-slim AS runtime
# Every pack operation shells out to the real git binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/languages/dist ./packages/languages/dist
COPY --from=build /app/packages/permissions/dist ./packages/permissions/dist
COPY --from=build /app/packages/references/dist ./packages/references/dist
COPY --from=build /app/packages/webhooks/dist ./packages/webhooks/dist
COPY --from=build /app/packages/templates/dist ./packages/templates/dist
COPY packages/db/drizzle ./packages/db/drizzle
# Statically linked, so the Alpine build runs on this Debian base.
COPY --from=zoekt /usr/local/bin/zoekt-git-index /usr/local/bin/zoekt-git-index
EXPOSE 3001 1031
# Unkey has no pre-deploy step, so each start migrates before serving; migrate.js takes a lock, so instances starting together apply each migration once.
CMD ["sh", "-c", "node packages/db/dist/migrate.js && exec node apps/api/dist/main.js"]
