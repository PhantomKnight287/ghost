# syntax=docker/dockerfile:1
# Built from the repository root, like the other services:
#   docker build -f apps/sync/api/Dockerfile .

FROM oven/bun:1.4.4-slim
# Ghost Sync shells out to git to mirror and push refs between the two hosts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/sync/api/package.json ./
# drizzle-kit is a dev dependency and runs the migrations on boot, so it stays.
RUN bun install
COPY apps/sync/api/drizzle.config.ts ./
COPY apps/sync/api/drizzle ./drizzle
COPY apps/sync/api/src ./src
# No VOLUME or USER: Railway refuses VOLUME and mounts its volume at
# SYNC_DATA_DIR owned by root, so the bare mirrors need root to write there.
ENV NODE_ENV=production
ENV SYNC_PORT=3006
EXPOSE 3006
CMD ["sh", "-c", "bunx drizzle-kit migrate && exec bun run src/index.ts"]
