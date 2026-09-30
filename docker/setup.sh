#!/usr/bin/env bash
# Configures and starts a self-hosted Ghost. Safe to re-run: existing answers in
# .env become the defaults, and generated secrets are never regenerated.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=.env

die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v docker >/dev/null || die "Docker is not installed: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing: https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it and run this again."

keep=""
if [[ -f $ENV_FILE ]]; then
  set -a; . "./$ENV_FILE"; set +a
  read -r -p "Found an existing configuration. Start Ghost with it as is? [Y/n] " keep || true
  if [[ ! $keep =~ ^[Nn] ]]; then
    docker compose up -d --build
    exit
  fi
fi

# ask VAR "question" default: the current value of VAR beats the default.
ask() {
  local cur="${!1:-${3:-}}" ans
  read -r -p "$2${cur:+ [$cur]}: " ans || die "No input: run this in a terminal."
  printf -v "$1" '%s' "${ans:-$cur}"
}
ask_secret() {
  local ans
  read -r -s -p "$2${!1:+ [keep current]}: " ans || die "No input: run this in a terminal."
  echo
  [[ -n $ans ]] && printf -v "$1" '%s' "$ans"
  return 0
}
confirm() {
  local ans
  read -r -p "$1 [${2:-Y/n}] " ans || die "No input: run this in a terminal."
  [[ -z $ans && ${2:-Y/n} == Y/n ]] || [[ $ans =~ ^[Yy] ]]
}
random() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

say "Where will Ghost live?"
echo "A domain (git.example.com) gets HTTPS on ports 80/443, with api. and docs. subdomains."
echo "An IP address or localhost serves plain HTTP on ports 3000 (web), 3001 (api), 3003 (docs)."
last_host=${SSH_CLONE_HOST:-localhost}
ask HOST "Domain or IP" "${DOMAIN:-${last_host%:*}}"
HOST=${HOST#http*://}; HOST=${HOST%%/*}

ask GIT_SSH_PORT "SSH port for git clone/push" 1031

if [[ $HOST == localhost || $HOST =~ ^[0-9.]+$ ]]; then
  DOMAIN=""; COMPOSE_PROFILES=http; AUTH_COOKIE_DOMAIN=""
  WEB_APP_URL="http://$HOST:3000"; API_URL="http://$HOST:3001"; DOCS_URL="http://$HOST:3003"
else
  DOMAIN=$HOST; COMPOSE_PROFILES=https; AUTH_COOKIE_DOMAIN=".$HOST"
  WEB_APP_URL="https://$HOST"; API_URL="https://api.$HOST"; DOCS_URL="https://docs.$HOST"
  echo "Point DNS A/AAAA records for $HOST, api.$HOST and docs.$HOST at this server."
fi
SSH_CLONE_HOST="$HOST:$GIT_SSH_PORT"

say "Email (required: verification, password resets, notifications)"
echo "  1) SMTP server"
echo "  2) HTTP email relay (EMAIL_PROXY), also lets apps/delivery retry emails"
default_mail=1; [[ -n ${EMAIL_PROXY:-} ]] && default_mail=2
ask MAIL_KIND "Choose 1 or 2" "$default_mail"
if [[ $MAIL_KIND == 2 ]]; then
  MAIL_HOST=""; MAIL_USER=""; MAIL_PASSWORD=""
  while ask EMAIL_PROXY "Relay URL" && [[ -z $EMAIL_PROXY ]]; do echo "Required."; done
  ask_secret EMAIL_PROXY_SECRET "Relay secret (empty for none)"
  DELIVERY_EMAIL=queue
else
  EMAIL_PROXY=""; EMAIL_PROXY_SECRET=""; DELIVERY_EMAIL=""
  while ask MAIL_HOST "SMTP host" && [[ -z $MAIL_HOST ]]; do echo "Required."; done
  ask MAIL_PORT "SMTP port" 587
  ask MAIL_USER "SMTP username"
  while ask_secret MAIL_PASSWORD "SMTP password" && [[ -z ${MAIL_PASSWORD:-} ]]; do echo "Required."; done
  MAIL_SECURE=false; [[ $MAIL_PORT == 465 ]] && MAIL_SECURE=true
fi
ask EMAIL_SENDER "Send email as" "Ghost <noreply@${DOMAIN:-ghost.local}>"
EMAIL_VERIFICATION_ENABLED=false
confirm "Require new accounts to verify their email?" && EMAIL_VERIFICATION_ENABLED=true

say "Storage"
if confirm "Use the bundled S3 storage (RustFS)? Say no for R2, Tigris, MinIO..."; then
  COMPOSE_PROFILES=${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}rustfs
  [[ ${S3_ENDPOINT:-} == http://rustfs:9000 ]] || { S3_ACCESS_KEY_ID=""; S3_SECRET_ACCESS_KEY=""; }
  S3_ENDPOINT=http://rustfs:9000; S3_BUCKET=ghost
  S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID:-ghost$(hex 4)}
  S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:-$(hex 24)}
else
  [[ ${S3_ENDPOINT:-} == http://rustfs:9000 ]] && S3_ENDPOINT=""
  ask S3_ENDPOINT "S3 endpoint URL"
  ask S3_BUCKET "Bucket" ghost
  ask S3_ACCESS_KEY_ID "Access key ID"
  ask_secret S3_SECRET_ACCESS_KEY "Secret access key"
fi

say "Secrets (press enter to generate)"
# Existing ones are kept: a new auth secret signs everyone out, a new webhook key
# makes every stored webhook secret unreadable, a new host key warns every client.
[[ -n ${BETTER_AUTH_SECRET:-} ]] || ask_secret BETTER_AUTH_SECRET "BETTER_AUTH_SECRET"
[[ -n ${WEBHOOK_SECRET_KEY:-} ]] || ask_secret WEBHOOK_SECRET_KEY "WEBHOOK_SECRET_KEY (32 bytes, base64)"
[[ -n ${GIT_SSH_HOST_KEY:-} ]] || ask_secret GIT_SSH_HOST_KEY "GIT_SSH_HOST_KEY (base64 private key)"
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-$(random 32)}
WEBHOOK_SECRET_KEY=${WEBHOOK_SECRET_KEY:-$(random 32)}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(hex 24)}
if [[ -z ${GIT_SSH_HOST_KEY:-} ]]; then
  echo "Generating an SSH host key..."
  GIT_SSH_HOST_KEY=$(docker run --rm alpine:3 sh -c \
    'apk add -q openssh-keygen >/dev/null && ssh-keygen -q -t ed25519 -N "" -C ghost -f /k && base64 -w0 /k')
fi

for v in MAIL_PASSWORD EMAIL_PROXY_SECRET S3_SECRET_ACCESS_KEY EMAIL_SENDER; do
  # ponytail: .env values are single-quoted so $ and spaces are literal; a quote would need an escape compose lacks.
  [[ ${!v:-} != *"'"* ]] || die "$v cannot contain a single quote (')."
done

umask 077
{
  echo "# Written by setup.sh. Re-run it to change answers, or edit and run: docker compose up -d --build"
  for v in COMPOSE_PROFILES DOMAIN WEB_APP_URL API_URL DOCS_URL SSH_CLONE_HOST \
    POSTGRES_PASSWORD BETTER_AUTH_SECRET AUTH_COOKIE_DOMAIN WEBHOOK_SECRET_KEY \
    GIT_SSH_HOST_KEY GIT_SSH_PORT S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY \
    EMAIL_SENDER EMAIL_VERIFICATION_ENABLED EMAIL_PROXY EMAIL_PROXY_SECRET DELIVERY_EMAIL \
    MAIL_HOST MAIL_PORT MAIL_SECURE MAIL_USER MAIL_PASSWORD; do
    # Empty values are left out: the API reads `EMAIL_PROXY=''` as set.
    [[ -z ${!v:-} ]] || printf "%s='%s'\n" "$v" "${!v}"
  done
  echo "DATABASE_URL='postgres://ghost:$POSTGRES_PASSWORD@postgres:5432/ghost'"
  echo "BETTER_AUTH_URL='$API_URL'"
  echo "AUTH_TRUSTED_ORIGINS='$WEB_APP_URL'"
  echo "ZOEKT_URL='http://zoekt:6070'"
} >"$ENV_FILE"

say "Building and starting Ghost. The first build takes several minutes."
docker compose up -d --build

say "Ghost is up."
echo "  Web   $WEB_APP_URL"
echo "  API   $API_URL   (git clone $API_URL/<user>/<repo>)"
echo "  Docs  $DOCS_URL"
echo "  SSH   ssh://git@$SSH_CLONE_HOST/<user>/<repo>.git"
echo
echo "Configuration is in $(pwd)/$ENV_FILE. Back it up: it holds every secret."
