#!/usr/bin/env bash
set -euo pipefail

revision=${1:-}
if [[ ! $revision =~ ^[0-9a-f]{40}$ ]]; then
  echo 'A full deployment revision is required.' >&2
  exit 64
fi

health=$(curl --fail --silent --show-error --max-time 8 http://127.0.0.1:8790/health/revision)
if [[ $health != *"$revision"* ]]; then
  echo 'Backend revision does not match the notification revision.' >&2
  exit 65
fi

env_file=/home/miono/tinyfrens-server/.env
secret=$(sed -n 's/^DEPLOY_NOTIFY_SECRET=//p' "$env_file" | tail -n 1)
secret=${secret#\"}
secret=${secret%\"}
if [[ -z $secret || $secret == *\\* ]]; then
  echo 'Deployment notification secret is missing or unsupported.' >&2
  exit 66
fi

curl --fail --silent --show-error --max-time 20 \
  --request POST http://127.0.0.1:8790/api/internal/deployment-verified \
  --header 'Content-Type: application/json' \
  --header "X-TinyFrens-Deploy-Secret: $secret" \
  --data "{\"revision\":\"$revision\",\"target\":\"backend\"}" >/dev/null

echo "Backend deployment notification delivered for $revision"
