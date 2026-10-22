#!/bin/sh
# The node keeps no state: every boot pulls the shards the API published to S3, then keeps following them.
set -eu

# Hosts that run the image under another user (Unkey) cannot write /data, so they point this at /tmp.
INDEX_DIR="${ZOEKT_INDEX_DIR:-/data/index}"
mkdir -p "$INDEX_DIR"

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
  rclone --config "" sync "s3:$S3_BUCKET/zoekt" "$INDEX_DIR" || echo "shard sync failed, serving what is on disk" >&2
}

# Syncing in the background keeps a slow or unreachable bucket from holding the webserver, and its healthcheck, hostage; zoekt loads shards as they land.
(while true; do sync_shards; sleep 10; done) &
# Platforms such as Railway healthcheck the port they hand out in PORT.
echo "Running zoekt-webserver on ${PORT:-6070}"
exec zoekt-webserver -index "$INDEX_DIR" -listen ":${PORT:-6070}" -rpc -html=false
