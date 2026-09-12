# syntax=docker/dockerfile:1
# Built from the repository root: the API depends on the @ghost/db workspace.
#   docker build -f apps/api/Dockerfile .

FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN bun run --filter @ghost/db build \
 && bun run --filter @ghost/api build

# A second, clean install: the runtime needs neither the web app's dependencies
# nor the compilers, and pruning in place leaves Bun's package store behind.
FROM oven/bun:1.3.14 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile --production \
      --filter '@ghost/api' --filter '@ghost/db'

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
COPY packages/db/drizzle ./packages/db/drizzle
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
