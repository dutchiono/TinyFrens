#!/usr/bin/env sh
set -eu
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/tinyfrens.lol ]; then
    nginx -t
    systemctl reload nginx
fi
