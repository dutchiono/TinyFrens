#!/usr/bin/env bash
set -euo pipefail

case ${1:-} in
  deploy-failure)
    message=$'🚨 TinyFrens deployment failed\n\nThe server rejected or rolled back an automated GitHub deployment. The previous healthy release remains active when rollback was possible.'
    ;;
  *)
    echo 'Unknown TinyFrens alert type.' >&2
    exit 64
    ;;
esac

if [[ -z ${TELEGRAM_BOT_TOKEN:-} || -z ${TELEGRAM_DEPLOY_OWNER_ID:-} ]]; then
  echo 'Telegram owner alert is not configured.' >&2
  exit 65
fi

curl --fail --silent --show-error --max-time 8 \
  --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_DEPLOY_OWNER_ID}" \
  --data-urlencode "text=${message}" >/dev/null
