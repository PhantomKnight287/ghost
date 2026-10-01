# syntax=docker/dockerfile:1
# Built from the repository root, like the other services:
#   docker build -f apps/importer/Dockerfile .

FROM oven/bun:1.3.14-slim
# The importer shells out to git for the clone and the push.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/importer/package.json ./
RUN bun install --production
COPY apps/importer/src ./src
USER bun
ENV PORT=3004
EXPOSE 3004
CMD ["bun", "run", "src/index.ts"]
