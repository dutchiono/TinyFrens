#!/usr/bin/env bash
set -euo pipefail

base=/home/miono/tinyfrens-ts-stage
alert_state="$base/backend-health-alerted"
recovery_alert_state="$base/backend-health-recovery-alerted"
discord_alert_state="$base/discord-health-alerted"
revision_env="$base/current-revision.env"
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

ensure_discord() {
  if [[ -z ${DISCORD_BOT_TOKEN:-} ]]; then return 0; fi
  local expected_revision='' running_revision='' pid=''
  if [[ -f $revision_env ]]; then
    expected_revision=$(sed -n 's/^APP_REVISION=//p' "$revision_env")
  fi
  if systemctl --user is-active --quiet tinyfrens-discord.service; then
    pid=$(systemctl --user show --property MainPID --value tinyfrens-discord.service)
    if [[ $pid =~ ^[1-9][0-9]*$ ]]; then
      running_revision=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^APP_REVISION=//p' || true)
    fi
  fi
  if systemctl --user is-active --quiet tinyfrens-discord.service &&
    { [[ -z $expected_revision ]] || [[ $running_revision == "$expected_revision" ]]; }; then
    if [[ -f $discord_alert_state ]]; then
      notify_owner $'✅ TinyFrens Discord bot recovered\n\nThe independent health monitor can see the Gateway worker again.'
      rm -f "$discord_alert_state"
    fi
    return 0
  fi

  local recovery_reason='stopped'
  if [[ -n $expected_revision && $running_revision != "$expected_revision" ]]; then
    recovery_reason='was running stale code'
  fi
  systemctl --user restart tinyfrens-discord.service
  sleep 2
  pid=$(systemctl --user show --property MainPID --value tinyfrens-discord.service)
  running_revision=''
  if [[ $pid =~ ^[1-9][0-9]*$ ]]; then
    running_revision=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^APP_REVISION=//p' || true)
  fi
  if systemctl --user is-active --quiet tinyfrens-discord.service &&
    { [[ -z $expected_revision ]] || [[ $running_revision == "$expected_revision" ]]; }; then
    notify_owner "⚠️ TinyFrens Discord bot auto-recovered

The Gateway worker $recovery_reason, so the independent monitor restarted it at revision ${running_revision:-unknown}."
    rm -f "$discord_alert_state"
    return 0
  fi
  if [[ ! -f $discord_alert_state ]]; then
    notify_owner $'🚨 TinyFrens Discord bot is down\n\nThe independent monitor restarted the Gateway worker, but it still fails. Manual attention is required.'
    touch "$discord_alert_state"
  fi
  return 1
}

if curl --fail --silent --max-time 5 http://127.0.0.1:8790/health >/dev/null; then
  if [[ -f $alert_state ]]; then
    notify_owner $'✅ TinyFrens backend recovered\n\nThe independent health monitor can reach the service again.'
    rm -f "$alert_state"
  fi
  ensure_discord
  exit $?
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
  ensure_discord
  exit $?
fi

if [[ ! -f $alert_state ]]; then
  notify_owner $'🚨 TinyFrens backend is down\n\nThe independent health monitor restarted the service, but health checks still fail. Manual attention is required.'
  touch "$alert_state"
fi
exit 1
