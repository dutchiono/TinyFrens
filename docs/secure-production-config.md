# Production configuration via GitHub Actions

The manual **Update production server configuration** workflow transfers one allowlisted GitHub environment secret or variable to the VPS using the existing restricted SSH deploy key. It updates the server's persistent `.env`, restarts services, verifies health, and rolls back on failure. It never logs secret values.

## First-time activation (required before use)

The existing SSH forced-command entrypoint only accepts `deploy <sha>`. The server administrator must update that **installed entrypoint** to the new `scripts/deploy-server-release.sh` version (or ensure the authorized_keys forced command resolves to the active release's version). Merely merging the PR **does not prove** the installed forced-command script changed. Do not try the config workflow until this is verified.

The deployment archive includes `scripts/update-server-env.sh` at `/home/miono/tinyfrens-ts-stage/current/scripts/update-server-env.sh`.

## Configure

In repository Settings → Environments → `production-backend`, add secrets `DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GITHUB_WEBHOOK_SECRET` as needed, and variable `DISCORD_UPDATES_CHANNEL_ID` with the numeric channel ID. Existing `TF_SERVER_SSH_KEY` and `TF_SERVER_KNOWN_HOSTS` must remain available to the workflow.

Run Actions → **Update production server configuration** → Run workflow (main) → select one key. Only approved keys are accepted. The workflow uses the same production deployment concurrency group and environment protections.

**Important:** Keep this PR unmerged until CI passes and the installed SSH forced-command activation plan is confirmed. For an unattended rollout, provision the forced-command entrypoint via an existing authorized server management mechanism; GitHub Actions cannot override an old forced-command restriction on its own.
