#!/bin/sh
# The node keeps no state: every boot pulls the shards the API published to S3, then keeps following them.
set -eu

export RCLONE_CONFIG_S3_TYPE=s3
export RCLONE_CONFIG_S3_PROVIDER=Other
export RCLONE_CONFIG_S3_REGION=auto
export RCLONE_CONFIG_S3_FORCE_PATH_STYLE=true
export RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT"
export RCLONE_CONFIG_S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"

# rclone downloads to a .partial file and renames it, and zoekt only loads *.zoekt, so a half-written shard is never served.
sync_shards() {
  # The remote lives in the environment above; an empty --config stops rclone looking for a file and logging that it found none on every run.
  rclone --config "" sync "s3:$S3_BUCKET/zoekt" /data/index || echo "shard sync failed, serving what is on disk" >&2
}

sync_shards
(while sleep 10; do sync_shards; done) &
# Platforms such as Railway healthcheck the port they hand out in PORT.
exec zoekt-webserver -index /data/index -listen ":${PORT:-6070}" -rpc -html=false
