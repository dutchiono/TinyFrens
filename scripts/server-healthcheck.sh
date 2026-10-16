#!/usr/bin/env bash
set -euo pipefail

base=/home/miono/tinyfrens-ts-stage
exec 9>"$base/deploy.lock"
if ! flock -n 9; then exit 0; fi

if curl --fail --silent --max-time 5 http://127.0.0.1:8790/health >/dev/null; then
  exit 0
fi

systemctl --user restart tinyfrens-server-ts.service
sleep 2
curl --fail --silent --max-time 5 http://127.0.0.1:8790/health >/dev/null
