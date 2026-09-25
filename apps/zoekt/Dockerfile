# syntax=docker/dockerfile:1
# Built from the repository root, like the other apps:
#   docker build -f apps/zoekt/Dockerfile .

# Keep in step with the zoekt stage in apps/api/Dockerfile: the indexer and the webserver share a shard format.
FROM ghcr.io/sourcegraph/zoekt:0.0.0-20260911061844-153817f643cd

USER root
RUN apk add --no-cache rclone
COPY --chmod=755 apps/zoekt/serve.sh /usr/local/bin/serve
USER zoekt

EXPOSE 6070
CMD ["serve"]
