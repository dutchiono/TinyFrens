# TypeScript server staging shadow runbook

This gate compares the frozen Python service with the TypeScript candidate on a staging host. It never sends production traffic or credentials to the candidate.

## Preconditions

- Use immutable image references for both implementations.
- Create two independent SQLite copies from the same consistent production snapshot. Never mount the live database.
- Keep the production relay running as the only production writer.
- Do not expose the shadow ports publicly. The Compose file binds them to loopback only.

## Start isolated shadows

Set these values on the staging host:

```sh
export TINYFRENS_PYTHON_SHADOW_IMAGE='registry.example/tinyfrens-python@sha256:...'
export TINYFRENS_TYPESCRIPT_SHADOW_IMAGE='registry.example/tinyfrens-server@sha256:...'
export SHADOW_ROOT='/srv/tinyfrens-shadow'
```

Create one SQLite online backup and two byte-identical service copies, then start the isolated profile:

```sh
cd server-ts
npm ci
npm run shadow:prepare -- /path/to/production-backup.db "$SHADOW_ROOT"
npm run shadow:validate
cd ..
docker compose -f server/compose.shadow.yml config
docker compose -f server/compose.shadow.yml up -d
```

The preparation command opens the source read-only, uses SQLite's backup API, runs `integrity_check`, and places the Python and TypeScript copies at distinct paths. The validation command rejects mutable image tags, missing or aliased database files, and copies that are not byte-identical.

The `internal` Docker network blocks outbound provider and RPC traffic. All provider credentials, webhook secrets, private keys, workers, moderation, deposits, and indexers are also disabled in the container environment.

## Compare

Run the hard-failing comparator from the checked-out candidate revision:

```sh
cd server-ts
PYTHON_SHADOW_URL=http://127.0.0.1:18080 \
TYPESCRIPT_SHADOW_URL=http://127.0.0.1:18081 \
SHADOW_CONFIRM=side-effects-disabled \
npm run shadow:compare
```

The manifest contains only side-effect-free reads, preflight requests, and requests rejected before mutation. A mismatch exits non-zero with the exact request name.

## Record and stop

Record image digests, database backup identity, comparator output, and container logs in the rollout record. Then stop and remove both shadows:

```sh
docker compose -f server/compose.shadow.yml down
```

Phase 10 is complete only after this run succeeds on staging. Local differential success does not satisfy the staging gate.
