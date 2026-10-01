# Configures and starts a self-hosted Ghost on Windows. Safe to re-run: existing
# answers in .env become the defaults, and generated secrets are never regenerated.
#   powershell -ExecutionPolicy Bypass -File docker\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$EnvFile = Join-Path $PSScriptRoot '.env'

function Die($msg) { Write-Host "`n$msg" -ForegroundColor Red; exit 1 }
function Say($msg) { Write-Host "`n$msg" -ForegroundColor White }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die 'Docker is not installed: https://docs.docker.com/desktop/setup/install/windows-install/' }
docker compose version *> $null; if ($LASTEXITCODE) { Die 'Docker Compose v2 is missing. Update Docker Desktop.' }
docker info *> $null; if ($LASTEXITCODE) { Die 'Docker is installed but not running. Start Docker Desktop and run this again.' }

$c = @{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match "^([A-Z0-9_]+)='(.*)'$") { $c[$Matches[1]] = $Matches[2] }
  }
  $keep = Read-Host 'Found an existing configuration. Start Ghost with it as is? [Y/n]'
  if ($keep -notmatch '^[Nn]') { docker compose up -d --build; exit $LASTEXITCODE }
}

function Ask($name, $question, $default = '') {
  $cur = if ($c[$name]) { $c[$name] } else { $default }
  $suffix = if ($cur) { " [$cur]" } else { '' }
  $ans = Read-Host "$question$suffix"
  $c[$name] = if ($ans) { $ans } else { $cur }
}
function AskSecret($name, $question) {
  $suffix = if ($c[$name]) { ' [keep current]' } else { '' }
  $s = Read-Host "$question$suffix" -AsSecureString
  $ans = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  if ($ans) { $c[$name] = $ans }
}
function AskYesNo($question, $defaultYes = $true) {
  $ans = Read-Host "$question $(if ($defaultYes) { '[Y/n]' } else { '[y/N]' })"
  if (-not $ans) { return $defaultYes }
  return $ans -match '^[Yy]'
}
function RandomBytes($n) {
  $b = New-Object byte[] $n
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ,$b
}
function Random64($n) { [Convert]::ToBase64String((RandomBytes $n)) }
function Hex($n) { ((RandomBytes $n) | ForEach-Object { $_.ToString('x2') }) -join '' }

Say 'Where will Ghost live?'
Write-Host 'A domain (git.example.com) gets HTTPS on ports 80/443, with api. and docs. subdomains.'
Write-Host 'An IP address or localhost serves plain HTTP on ports 3000 (web), 3001 (api), 3003 (docs).'
$lastHost = if ($c.DOMAIN) { $c.DOMAIN } elseif ($c.SSH_CLONE_HOST) { $c.SSH_CLONE_HOST -replace ':\d+$', '' } else { 'localhost' }
Ask HOST 'Domain or IP' $lastHost
$h = ($c.HOST -replace '^https?://', '') -replace '/.*$', ''
Ask GIT_SSH_PORT 'SSH port for git clone/push' '1031'

if ($h -eq 'localhost' -or $h -match '^[0-9.]+$') {
  $c.DOMAIN = ''; $c.COMPOSE_PROFILES = 'http'; $c.AUTH_COOKIE_DOMAIN = ''
  $c.WEB_APP_URL = "http://${h}:3000"; $c.API_URL = "http://${h}:3001"; $c.DOCS_URL = "http://${h}:3003"
} else {
  $c.DOMAIN = $h; $c.COMPOSE_PROFILES = 'https'; $c.AUTH_COOKIE_DOMAIN = ".$h"
  $c.WEB_APP_URL = "https://$h"; $c.API_URL = "https://api.$h"; $c.DOCS_URL = "https://docs.$h"
  Write-Host "Point DNS A/AAAA records for $h, api.$h and docs.$h at this server."
}
$c.SSH_CLONE_HOST = "${h}:$($c.GIT_SSH_PORT)"

Say 'Email (required: verification, password resets, notifications)'
Write-Host '  1) SMTP server'
Write-Host '  2) HTTP email relay (EMAIL_PROXY), also lets apps/delivery retry emails'
Ask MAIL_KIND 'Choose 1 or 2' $(if ($c.EMAIL_PROXY) { '2' } else { '1' })
if ($c.MAIL_KIND -eq '2') {
  $c.MAIL_HOST = ''; $c.MAIL_USER = ''; $c.MAIL_PASSWORD = ''
  do { Ask EMAIL_PROXY 'Relay URL' } until ($c.EMAIL_PROXY)
  AskSecret EMAIL_PROXY_SECRET 'Relay secret (empty for none)'
  $c.DELIVERY_EMAIL = 'queue'
} else {
  $c.EMAIL_PROXY = ''; $c.EMAIL_PROXY_SECRET = ''; $c.DELIVERY_EMAIL = ''
  do { Ask MAIL_HOST 'SMTP host' } until ($c.MAIL_HOST)
  Ask MAIL_PORT 'SMTP port' '587'
  Ask MAIL_USER 'SMTP username'
  do { AskSecret MAIL_PASSWORD 'SMTP password' } until ($c.MAIL_PASSWORD)
  $c.MAIL_SECURE = if ($c.MAIL_PORT -eq '465') { 'true' } else { 'false' }
}
Ask EMAIL_SENDER 'Send email as' "Ghost <noreply@$(if ($c.DOMAIN) { $c.DOMAIN } else { 'ghost.local' })>"
$c.EMAIL_VERIFICATION_ENABLED = if (AskYesNo 'Require new accounts to verify their email?') { 'true' } else { 'false' }

Say 'Storage'
if (AskYesNo 'Use the bundled S3 storage (RustFS)? Say no for R2, Tigris, MinIO...') {
  $c.COMPOSE_PROFILES = (@($c.COMPOSE_PROFILES, 'rustfs') | Where-Object { $_ }) -join ','
  if ($c.S3_ENDPOINT -ne 'http://rustfs:9000') { $c.S3_ACCESS_KEY_ID = ''; $c.S3_SECRET_ACCESS_KEY = '' }
  $c.S3_ENDPOINT = 'http://rustfs:9000'; $c.S3_BUCKET = 'ghost'
  if (-not $c.S3_ACCESS_KEY_ID) { $c.S3_ACCESS_KEY_ID = "ghost$(Hex 4)" }
  if (-not $c.S3_SECRET_ACCESS_KEY) { $c.S3_SECRET_ACCESS_KEY = Hex 24 }
} else {
  if ($c.S3_ENDPOINT -eq 'http://rustfs:9000') { $c.S3_ENDPOINT = '' }
  Ask S3_ENDPOINT 'S3 endpoint URL'
  Ask S3_BUCKET 'Bucket' 'ghost'
  Ask S3_ACCESS_KEY_ID 'Access key ID'
  AskSecret S3_SECRET_ACCESS_KEY 'Secret access key'
}

Say 'GitHub imports (optional)'
Write-Host 'Lets people import a GitHub repository with its code, releases, issues and pull requests.'
Write-Host 'Needs a GitHub OAuth app: https://github.com/settings/applications/new'
Write-Host "  Homepage URL:   $($c.WEB_APP_URL)"
Write-Host "  Callback URL:   $($c.API_URL)/api/auth/callback/github"
if (AskYesNo 'Turn on GitHub imports?' ([bool]$c.GITHUB_CLIENT_ID)) {
  $c.COMPOSE_PROFILES = "$($c.COMPOSE_PROFILES),importer"
  do { Ask GITHUB_CLIENT_ID 'OAuth app client ID' } until ($c.GITHUB_CLIENT_ID)
  do { AskSecret GITHUB_CLIENT_SECRET 'OAuth app client secret' } until ($c.GITHUB_CLIENT_SECRET)
  $c.IMPORTER_URL = 'http://importer:3004'
  if (-not $c.IMPORTER_SECRET) { $c.IMPORTER_SECRET = Hex 32 }
} else {
  $c.GITHUB_CLIENT_ID = ''; $c.GITHUB_CLIENT_SECRET = ''; $c.IMPORTER_URL = ''; $c.IMPORTER_SECRET = ''
}

Say 'Secrets (press enter to generate)'
# Existing ones are kept: a new auth secret signs everyone out, a new webhook key
# makes every stored webhook secret unreadable, a new host key warns every client.
if (-not $c.BETTER_AUTH_SECRET) { AskSecret BETTER_AUTH_SECRET 'BETTER_AUTH_SECRET' }
if (-not $c.WEBHOOK_SECRET_KEY) { AskSecret WEBHOOK_SECRET_KEY 'WEBHOOK_SECRET_KEY (32 bytes, base64)' }
if (-not $c.GIT_SSH_HOST_KEY) { AskSecret GIT_SSH_HOST_KEY 'GIT_SSH_HOST_KEY (base64 private key)' }
if (-not $c.BETTER_AUTH_SECRET) { $c.BETTER_AUTH_SECRET = Random64 32 }
if (-not $c.WEBHOOK_SECRET_KEY) { $c.WEBHOOK_SECRET_KEY = Random64 32 }
if (-not $c.POSTGRES_PASSWORD) { $c.POSTGRES_PASSWORD = Hex 24 }
if (-not $c.GIT_SSH_HOST_KEY) {
  Write-Host 'Generating an SSH host key...'
  # No double quotes in the script: Windows PowerShell mangles them on the way to docker.
  $c.GIT_SSH_HOST_KEY = (docker run --rm alpine:3 sh -c 'apk add -q openssh-keygen >/dev/null && ssh-keygen -q -t ed25519 -N '''' -C ghost -f /k && base64 -w0 /k' | Out-String).Trim()
  if ($LASTEXITCODE -or -not $c.GIT_SSH_HOST_KEY) { Die 'Could not generate an SSH host key.' }
}

foreach ($v in 'MAIL_PASSWORD', 'EMAIL_PROXY_SECRET', 'S3_SECRET_ACCESS_KEY', 'EMAIL_SENDER', 'GITHUB_CLIENT_SECRET') {
  # ponytail: .env values are single-quoted so $ and spaces are literal; a quote would need an escape compose lacks.
  if ("$($c[$v])".Contains("'")) { Die "$v cannot contain a single quote (')." }
}

$c.DATABASE_URL = "postgres://ghost:$($c.POSTGRES_PASSWORD)@postgres:5432/ghost"
$c.BETTER_AUTH_URL = $c.API_URL
$c.AUTH_TRUSTED_ORIGINS = $c.WEB_APP_URL
$c.ZOEKT_URL = 'http://zoekt:6070'
$keys = 'COMPOSE_PROFILES', 'DOMAIN', 'WEB_APP_URL', 'API_URL', 'DOCS_URL', 'SSH_CLONE_HOST',
  'POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET', 'AUTH_COOKIE_DOMAIN', 'WEBHOOK_SECRET_KEY',
  'GIT_SSH_HOST_KEY', 'GIT_SSH_PORT', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'EMAIL_SENDER', 'EMAIL_VERIFICATION_ENABLED', 'EMAIL_PROXY', 'EMAIL_PROXY_SECRET', 'DELIVERY_EMAIL',
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE', 'MAIL_USER', 'MAIL_PASSWORD',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'IMPORTER_URL', 'IMPORTER_SECRET',
  'DATABASE_URL', 'BETTER_AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'ZOEKT_URL'
$lines = @('# Written by setup.ps1. Re-run it to change answers, or edit and run: docker compose up -d --build')
# Empty values are left out: the API reads `EMAIL_PROXY=''` as set.
$lines += $keys | Where-Object { $c[$_] } | ForEach-Object { "$_='$($c[$_])'" }
# No BOM and LF endings: compose reads the file byte for byte.
[IO.File]::WriteAllText($EnvFile, ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))

Say 'Building and starting Ghost. The first build takes several minutes.'
docker compose up -d --build
if ($LASTEXITCODE) { Die 'docker compose up failed. Fix the error above and run this again.' }

Say 'Ghost is up.'
Write-Host "  Web   $($c.WEB_APP_URL)"
Write-Host "  API   $($c.API_URL)   (git clone $($c.API_URL)/<user>/<repo>)"
Write-Host "  Docs  $($c.DOCS_URL)"
Write-Host "  SSH   ssh://git@$($c.SSH_CLONE_HOST)/<user>/<repo>.git"
Write-Host "`nConfiguration is in $EnvFile. Back it up: it holds every secret."
