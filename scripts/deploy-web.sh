#!/usr/bin/env bash
# Run locally from the repository on a host with Node, tar, scp and SSH access.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build-site.mjs
revision=$(git rev-parse HEAD)
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
tar -czf "$archive" -C dist .
scp "$archive" "miono:tinyfrens-web-${revision}.tar.gz"
ssh miono bash -s -- "$revision" <<'REMOTE'
set -euo pipefail
revision=$1
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
release="/var/www/tinyfrens/releases/$revision"
sudo install -d -m 755 "$release"
sudo tar -xzf "$HOME/tinyfrens-web-$revision.tar.gz" -C "$release"
sudo chmod -R a+rX "$release"
sudo ln -sfn "$release" /var/www/tinyfrens/current.next
sudo mv -Tf /var/www/tinyfrens/current.next /var/www/tinyfrens/current
rm "$HOME/tinyfrens-web-$revision.tar.gz"
curl --fail --silent --show-error https://tinyfrens.lol/ >/dev/null
REMOTE
