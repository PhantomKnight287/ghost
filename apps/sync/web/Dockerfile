# syntax=docker/dockerfile:1
# Built from the repository root:
#   docker build -f apps/sync/web/Dockerfile --build-arg VITE_SYNC_API_URL=... .

FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY apps/sync/web/package.json ./
RUN bun install
COPY apps/sync/web ./
# Vite inlines the API origin into the bundle, so it has to be known here, not at boot.
ARG VITE_SYNC_API_URL
ENV VITE_SYNC_API_URL=$VITE_SYNC_API_URL
RUN bunx tsc --noEmit && bunx vite build

# Every page renders in the browser, so the SPA shell and its assets are all
# there is to serve; unknown paths fall back to the shell for the router.
FROM caddy:2 AS runtime
COPY --from=build /app/dist/client /srv
EXPOSE 3009
ENV PORT=3009
# The image's default command serves /etc/caddy/Caddyfile; {$PORT} is read at boot.
RUN printf ':{$PORT}\nroot * /srv\ntry_files {path} /_shell.html\nfile_server\n' > /etc/caddy/Caddyfile
