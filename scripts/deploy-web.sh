#!/usr/bin/env bash
# Manual recovery publish through the same restricted receiver used by Actions.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TF_WEB_SSH_KEY_FILE:?Set the path to the dedicated website deployment key}"
: "${TF_WEB_KNOWN_HOSTS_FILE:?Set the path to the pinned server host keys}"
node scripts/build-site.mjs
revision=$(git rev-parse HEAD)
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
tar -czf "$archive" -C dist .
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$TF_WEB_KNOWN_HOSTS_FILE" \
  -i "$TF_WEB_SSH_KEY_FILE" tinyfrens-deploy@198.71.54.203 \
  "publish $revision" < "$archive"
python scripts/verify-web-hosting.py --address 198.71.54.203
