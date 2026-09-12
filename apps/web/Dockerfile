# syntax=docker/dockerfile:1
# Built from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... .

FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile

# Bun installs the workspace, but `next build` runs on Node: the Bun runtime
# segfaults on this build.
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app ./
COPY . .
# NEXT_PUBLIC_* is inlined at build time, so the browser's API origin has to be
# known here, not at boot.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV PATH=/app/node_modules/.bin:/app/apps/web/node_modules/.bin:$PATH
# `src/lib/api/v1.d.ts` is committed, so the openapi codegen step is skipped.
RUN cd packages/db && tsc -p tsconfig.json
RUN cd apps/web && next build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# `standalone` ships its own pruned node_modules; static assets are not in it.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
