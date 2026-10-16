#!/usr/bin/env bash
set -euo pipefail

base=/home/miono/tinyfrens-ts-stage
alert_state="$base/backend-health-alerted"
recovery_alert_state="$base/backend-health-recovery-alerted"
exec 9>"$base/deploy.lock"
if ! flock -n 9; then exit 0; fi

notify_owner() {
  local message=$1
  if [[ -z ${TELEGRAM_BOT_TOKEN:-} || -z ${TELEGRAM_DEPLOY_OWNER_ID:-} ]]; then
    echo 'Telegram owner alert is not configured.' >&2
    return
  fi
  if ! curl --fail --silent --show-error --max-time 8 \
    --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_DEPLOY_OWNER_ID}" \
    --data-urlencode "text=${message}" >/dev/null; then
    echo 'Telegram owner alert delivery failed.' >&2
  fi
}

if curl --fail --silent --max-time 5 http://127.0.0.1:8790/health >/dev/null; then
  if [[ -f $alert_state ]]; then
    notify_owner $'✅ TinyFrens backend recovered\n\nThe independent health monitor can reach the service again.'
    rm -f "$alert_state"
  fi
  exit 0
fi

systemctl --user restart tinyfrens-server-ts.service
sleep 2
if curl --fail --silent --max-time 5 http://127.0.0.1:8790/health >/dev/null; then
  now=$(date +%s)
  last_recovery_alert=0
  if [[ -f $recovery_alert_state ]]; then
    last_recovery_alert=$(stat -c %Y "$recovery_alert_state")
  fi
  if (( now - last_recovery_alert >= 15 * 60 )); then
    notify_owner $'⚠️ TinyFrens backend auto-recovered\n\nThe health check failed, so the independent monitor restarted the service successfully.'
    touch "$recovery_alert_state"
  fi
  rm -f "$alert_state"
  exit 0
fi

if [[ ! -f $alert_state ]]; then
  notify_owner $'🚨 TinyFrens backend is down\n\nThe independent health monitor restarted the service, but health checks still fail. Manual attention is required.'
  touch "$alert_state"
fi
exit 1
