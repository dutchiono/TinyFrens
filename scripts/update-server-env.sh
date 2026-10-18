#!/usr/bin/env bash
set -euo pipefail
# Invoked ONLY by the existing forced-command SSH entrypoint.
key=${1:?configuration key required}
case "$key" in
  DISCORD_UPDATES_CHANNEL_ID|DISCORD_BOT_TOKEN|GEMINI_API_KEY|TELEGRAM_BOT_TOKEN|GITHUB_WEBHOOK_SECRET) ;;
  *) echo 'Configuration key is not permitted' >&2; exit 64 ;;
esac
umask 077
env_file=/home/miono/tinyfrens-server/.env
lock=/home/miono/tinyfrens-ts-stage/deploy.lock
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -x 9
test -f "$env_file" || { echo 'Production .env missing' >&2; exit 66; }
value=$(cat)
if [[ -z "$value" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
  echo 'Value must be nonempty and single-line' >&2; exit 65
fi
if [[ "$key" == DISCORD_UPDATES_CHANNEL_ID && ! "$value" =~ ^[0-9]{15,22}$ ]]; then
  echo 'Invalid Discord channel ID' >&2; exit 65
fi
# Systemd EnvironmentFile supports quoted values. Escape backslashes and double quotes.
escaped=${value//\\/\\\\}
escaped=${escaped//\"/\\\"}
tmp=$(mktemp "${env_file}.new.XXXXXX")
backup=$(mktemp "${env_file}.bak.XXXXXX")
cleanup() { rm -f "$tmp" "$backup"; }
trap cleanup EXIT
cp -p "$env_file" "$backup"
awk -v key="$key" 'index($0,key "=")!=1 { print }' "$env_file" > "$tmp"
printf '%s="%s"\n' "$key" "$escaped" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$env_file"
if ! systemctl --user restart tinyfrens-server-ts.service ||
   ! systemctl --user restart tinyfrens-discord.service; then
  cp -p "$backup" "$env_file"
  systemctl --user restart tinyfrens-server-ts.service || true
  systemctl --user restart tinyfrens-discord.service || true
  echo 'Restart failed; restored previous configuration' >&2
  exit 67
fi
for _ in {1..10}; do
  if systemctl --user is-active --quiet tinyfrens-server-ts.service &&
     systemctl --user is-active --quiet tinyfrens-discord.service &&
     curl --fail --silent --max-time 3 http://127.0.0.1:8790/health >/dev/null; then
    echo 'Configuration updated and services healthy'
    exit 0
  fi
  sleep 2
done
cp -p "$backup" "$env_file"
systemctl --user restart tinyfrens-server-ts.service || true
systemctl --user restart tinyfrens-discord.service || true
echo 'Health check failed; restored previous configuration' >&2
exit 68
