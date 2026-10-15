# TypeScript server read-only canary runbook

Do not begin this phase until the staging shadow gate succeeds. Python remains the only writer throughout this canary.

## Preconditions

- Create and verify a production database backup.
- Use immutable Python and TypeScript image digests.
- Confirm the Python image is the currently deployed production artifact.
- Confirm `server/Caddyfile` is available for immediate proxy rollback.

## Start the canary

Set `TINYFRENS_PYTHON_IMAGE`, `TINYFRENS_TYPESCRIPT_IMAGE`, and `PET_DOMAIN`, then validate and start the explicit canary stack:

```sh
docker compose -f server/compose.canary.yml config
docker compose -f server/compose.canary.yml up -d
```

The proxy sends only GET, HEAD, and OPTIONS requests for the allowlisted public/read-only paths to TypeScript. Every other request goes to Python. The TypeScript container mounts the shared volume read-only, opens SQLite with `DB_READ_ONLY=true`, skips schema initialization, and starts no workers.

## Verify

Check health, the allowlisted routes, Python mutation routes, WebSockets, webhook ownership, and logs. Verify that the TypeScript container cannot write:

```sh
docker compose -f server/compose.canary.yml logs --no-log-prefix relay-typescript relay-python caddy
docker compose -f server/compose.canary.yml exec relay-typescript node -e "const D=require('better-sqlite3');const d=new D('/data/tinyfrens.db',{readonly:true,fileMustExist:true});console.log(d.pragma('query_only',{simple:true}));d.close()"
```

Record image digests, backup identity, start time, route results, error rates, and logs. Do not expand the allowlist while any mismatch is unresolved.

## Immediate rollback

Recreate only Caddy with the normal Python-only configuration; Python remains live and keeps the only writable database mount throughout:

```sh
CADDYFILE_PATH=./Caddyfile docker compose -f server/compose.canary.yml up -d --no-deps --force-recreate caddy
```

After traffic is confirmed on Python, stop the TypeScript canary. Do not remove its image or the production backup until the observation window is complete.
