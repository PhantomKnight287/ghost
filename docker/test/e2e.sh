#!/usr/bin/env bash
# Installs Ghost with setup.sh exactly as a self-hoster would, then drives it
# from the outside with e2e.mjs. Tears everything down afterwards unless KEEP=1.
#   docker/test/e2e.sh
# E2E_COMPOSE_EXTRA adds one more compose file, for example to move ports that
# are taken on this machine; the E2E_* URLs in e2e.mjs then follow it.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
docker_dir=$(dirname "$here")
cd "$docker_dir"

[[ ! -f .env ]] || { echo "docker/.env exists; e2e.sh would overwrite a real configuration. Run it in a fresh checkout." >&2; exit 1; }

export COMPOSE_FILE="compose.yaml:test/compose.e2e.yaml${E2E_COMPOSE_EXTRA:+:$E2E_COMPOSE_EXTRA}"

cleanup() {
  status=$?
  if [[ $status != 0 ]]; then
    docker compose ps -a || true
    docker compose logs --no-color --tail=200 || true
  fi
  if [[ ${KEEP:-} != 1 ]]; then
    docker compose down -v --remove-orphans || true
    rm -f .env
  fi
  exit $status
}
trap cleanup EXIT

# Answers, in order: address, SSH port, SMTP, host, port, user, password,
# sender, require verification, bundled storage, then three generated secrets.
printf '%s\n' localhost '' 1 mailpit 1025 e2e e2e '' y '' '' '' '' | ./setup.sh

node "$here/e2e.mjs"
