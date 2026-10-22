#!/usr/bin/env bash
set -euo pipefail

base=/home/miono/tinyfrens-ts-stage
command=${SSH_ORIGINAL_COMMAND:-}
if [[ $command =~ ^config-update\ (DISCORD_UPDATES_CHANNEL_ID|DISCORD_BOT_TOKEN|GEMINI_API_KEY|TELEGRAM_BOT_TOKEN|GITHUB_WEBHOOK_SECRET)$ ]]; then
  exec /home/miono/tinyfrens-ts-stage/current/scripts/update-server-env.sh "${BASH_REMATCH[1]}"
fi
if [[ $command =~ ^notify\ ([0-9a-f]{40})$ ]]; then
  exec /home/miono/tinyfrens-ts-stage/current/scripts/notify-server-deployment.sh "${BASH_REMATCH[1]}"
fi
if [[ ! $command =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo 'Only deploy <full-git-sha>, notify <full-git-sha>, or an approved config-update is permitted.' >&2
  exit 64
fi
revision=${BASH_REMATCH[1]}
release="$base/runtime-${revision:0:12}"
stage="$base/.incoming-$revision"
archive="$base/.incoming-$revision.tar.gz"
current="$base/current"
revision_env="$base/current-revision.env"

discord_matches_revision() {
  [[ -f $current/server-ts/dist/discord-main.js ]] || return 0
  systemctl --user is-active --quiet tinyfrens-discord.service || return 1
  local pid running_revision
  pid=$(systemctl --user show --property MainPID --value tinyfrens-discord.service)
  [[ $pid =~ ^[1-9][0-9]*$ ]] || return 1
  running_revision=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^APP_REVISION=//p' || true)
  [[ $running_revision == "$revision" ]]
}

alert_deploy_failure() {
  if ! systemctl --user start tinyfrens-deploy-failure-alert.service; then
    echo 'Could not start the deployment failure alert.' >&2
  fi
}

deploy_failed() {
  local status=$?
  trap - ERR
  alert_deploy_failure
  exit "$status"
}
trap deploy_failed ERR

mkdir -p "$base"
exec 9>"$base/deploy.lock"
flock -x 9

if [[ -L $current ]] && [[ $(readlink -f "$current") == "$release" ]]; then
  systemctl --user restart tinyfrens-server-ts.service
  if [[ -f $current/server-ts/dist/discord-main.js ]]; then
    systemctl --user restart tinyfrens-discord.service
  fi
  for _ in {1..15}; do
    if curl --fail --silent --max-time 5 http://127.0.0.1:8790/health/revision | grep -Fq "$revision" &&
      discord_matches_revision; then
      exit 0
    fi
    sleep 2
  done
  echo 'The active release could not be recovered.' >&2
  exit 67
fi

rm -f "$archive"
rm -rf "$stage"
cleanup() {
  trap - EXIT
  rm -f "$archive"
  rm -rf "$stage"
}
trap cleanup EXIT

umask 077
dd of="$archive" status=none
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo 'Archive contains an unsafe path.' >&2
  exit 65
fi
mkdir "$stage"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$stage"
test -f "$stage/server-ts/package-lock.json"
test -f "$stage/.node-version"
test -f "$stage/ops/systemd/tinyfrens-server-ts.service"
test -f "$stage/ops/systemd/tinyfrens-discord.service"
test -f "$stage/ops/systemd/tinyfrens-deploy-failure-alert.service"

export PATH="$base/toolchain/bin:$PATH"
required_node=$(tr -d '\r\n' < "$stage/.node-version")
actual_node=$("$base/toolchain/bin/node" --version)
if [[ -z $required_node || $actual_node != "v$required_node" ]]; then
  echo "Deployment requires Node v$required_node; installed toolchain is $actual_node." >&2
  exit 66
fi
cd "$stage/server-ts"
npm ci
npm run build
"$base/toolchain/bin/node" test/startup-smoke.mjs

if [[ -e $release ]]; then
  rm -rf "$release"
fi
mv "$stage" "$release"

previous_target=''
previous_revision=''
if [[ -L $current ]]; then previous_target=$(readlink "$current"); fi
if [[ -f $revision_env ]]; then previous_revision=$(cat "$revision_env"); fi

rollback() {
  local status=$?
  trap - ERR
  if [[ -n $previous_target ]]; then
    ln -sfn "$previous_target" "$current"
  else
    rm -f "$current"
  fi
  if [[ -n $previous_revision ]]; then
    printf '%s\n' "$previous_revision" > "$revision_env"
  else
    rm -f "$revision_env"
  fi
  systemctl --user daemon-reload
  systemctl --user restart tinyfrens-server-ts.service || true
  if [[ -f $current/server-ts/dist/discord-main.js ]]; then
    systemctl --user restart tinyfrens-discord.service || true
  else
    systemctl --user disable --now tinyfrens-discord.service || true
  fi
  rm -rf "$release"
  alert_deploy_failure
  exit "$status"
}
trap rollback ERR

install -m 0644 "$release/ops/systemd/tinyfrens-server-ts.service" "$HOME/.config/systemd/user/tinyfrens-server-ts.service"
install -m 0644 "$release/ops/systemd/tinyfrens-discord.service" "$HOME/.config/systemd/user/tinyfrens-discord.service"
install -m 0644 "$release/ops/systemd/tinyfrens-server-health.service" "$HOME/.config/systemd/user/tinyfrens-server-health.service"
install -m 0644 "$release/ops/systemd/tinyfrens-server-health.timer" "$HOME/.config/systemd/user/tinyfrens-server-health.timer"
install -m 0644 "$release/ops/systemd/tinyfrens-deploy-failure-alert.service" "$HOME/.config/systemd/user/tinyfrens-deploy-failure-alert.service"
ln -sfn "$release" "$current"
printf 'APP_REVISION=%s\n' "$revision" > "$revision_env"
systemctl --user daemon-reload
systemctl --user enable --now tinyfrens-server-ts.service tinyfrens-discord.service tinyfrens-server-health.timer
systemctl --user restart tinyfrens-server-ts.service
systemctl --user restart tinyfrens-discord.service

for _ in {1..15}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:8790/health/revision | grep -Fq "$revision" &&
    discord_matches_revision; then
    trap - ERR
    exit 0
  fi
  sleep 2
done
false
