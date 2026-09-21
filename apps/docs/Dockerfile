# syntax=docker/dockerfile:1
# Built from the repository root:
#   docker build -f apps/docs/Dockerfile --build-arg NEXT_PUBLIC_WEB_APP_URL=... .

FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/languages/package.json packages/languages/package.json
RUN bun install --frozen-lockfile

# Bun installs the workspace, but `next build` runs on Node: the Bun runtime
# segfaults on this build.
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/docs/node_modules apps/docs/node_modules
COPY package.json bun.lock ./
COPY apps/docs apps/docs
# Both are inlined into the bundle at build time, so the origins have to be
# known here, not at boot.
ARG NEXT_PUBLIC_WEB_APP_URL
ARG NEXT_PUBLIC_DOCS_URL
ENV NEXT_PUBLIC_WEB_APP_URL=$NEXT_PUBLIC_WEB_APP_URL
ENV NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV PATH=/app/node_modules/.bin:/app/apps/docs/node_modules/.bin:$PATH
RUN cd apps/docs && next build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# `standalone` ships its own pruned node_modules; static assets are not in it.
COPY --from=build /app/apps/docs/.next/standalone ./
COPY --from=build /app/apps/docs/.next/static ./apps/docs/.next/static
EXPOSE 3003
ENV PORT=3003
# The standalone server binds to $HOSTNAME, which container runtimes set to the
# container id: that is a single interface, so a platform proxy arriving on any
# other one is refused. Overriding it here beats a runtime-injected value, which
# an `ENV` line would not.
CMD ["sh", "-c", "export HOSTNAME=0.0.0.0; exec node apps/docs/server.js"]
