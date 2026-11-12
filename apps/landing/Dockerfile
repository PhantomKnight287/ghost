# syntax=docker/dockerfile:1
# Built from the repository root:
#   docker build -f apps/landing/Dockerfile --build-arg NEXT_PUBLIC_WEB_APP_URL=... .

FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/learn/package.json apps/learn/package.json
COPY apps/landing/package.json apps/landing/package.json
COPY apps/delivery/package.json apps/delivery/package.json
COPY apps/importer/package.json apps/importer/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/languages/package.json packages/languages/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/references/package.json packages/references/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/webhooks/package.json packages/webhooks/package.json
RUN bun install --frozen-lockfile

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/landing/node_modules apps/landing/node_modules
COPY package.json bun.lock ./
COPY apps/landing apps/landing
# Vite inlines these into the bundle at build time, so the origins have to be
# known here, not at boot.
ARG NEXT_PUBLIC_WEB_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DOCS_URL
ARG NEXT_PUBLIC_LEARN_URL
ARG NEXT_PUBLIC_REPOSITORY_URL
ENV NEXT_PUBLIC_WEB_APP_URL=$NEXT_PUBLIC_WEB_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL
ENV NEXT_PUBLIC_LEARN_URL=$NEXT_PUBLIC_LEARN_URL
ENV NEXT_PUBLIC_REPOSITORY_URL=$NEXT_PUBLIC_REPOSITORY_URL
ENV PATH=/app/node_modules/.bin:/app/apps/landing/node_modules/.bin:$PATH
RUN cd apps/landing && tsc --noEmit && vite build

FROM caddy:2 AS runtime
COPY --from=build /app/apps/landing/dist /srv
EXPOSE 3006
ENV PORT=3006
CMD ["sh", "-c", "exec caddy file-server --root /srv --listen :$PORT"]
