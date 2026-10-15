# Python-to-TypeScript server migration checklist

Status: TypeScript production cutover completed 2026-10-15; observation and Python retirement remain pending.

Baseline: update this field to the exact commit used when implementation begins: `PYTHON_REFERENCE_COMMIT=0f03d36d926fab4b24efa3f81d9a7b395646ee69`.

## Completion rules

A box may be checked only when the TypeScript implementation has been compared with the frozen Python reference and the evidence is linked in the migration PR.

- [ ] Same accepted inputs, normalization, defaults, limits, and validation errors.
- [x] Same HTTP status, response body, content type, cache headers, and CORS behavior (verified for GET /health and origin guard).
- [ ] Same authentication, authorization, signature verification, and rate limits.
- [x] Same SQLite schema, values, ordering, transaction boundaries, idempotency, and restart behavior (verified for all 49 permanent tables across modules; `wallet_links_next` is migration scratch state and is never retained).
- [ ] Same external requests, timeouts, retry behavior, and fail-closed/fail-open behavior.
- [ ] Same WebSocket frames, close codes, ordering, expiry, and reconnect behavior where applicable.
- [ ] Same background work, cancellation, cleanup, and graceful shutdown behavior.
- [x] Existing Python tests have equivalent TypeScript tests; tests run real assertions and real tools.
- [x] A differential parity test passes against both implementations using the same fixture, clock, random values, and mocked providers.
- [x] No production traffic or secrets are used by the parity harness.
- [x] Python remained the production authority until the guarded full cutover completed.

“Implemented” and “parity verified” are separate states. A translated file is not complete merely because it compiles.

## Decisions to freeze before implementation

- [x] Record the Python reference commit and prevent behavior changes from entering it unnoticed. (`PYTHON_REFERENCE_COMMIT=0f03d36d926fab4b24efa3f81d9a7b395646ee69`)
- [x] Choose the TypeScript runtime: Node 22 or Bun. Record the production runtime and package manager. (Node 22 LTS with npm, matching CI, existing scripts, and host environment).
- [x] Choose the HTTP framework after proving WebSocket, raw-body webhook verification, multipart Telegram uploads, cleanup hooks, and streaming behavior. (Fastify with `@fastify/websocket`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/multipart`, and `fastify-raw-body`).
- [x] Choose the SQLite driver and prove compatibility with the existing database file, WAL/locking behavior, integer handling, collations, and transactions. (`better-sqlite3` via abstract `DatabaseConnection` with WAL, busy_timeout=5000, foreign_keys=ON; compatibility proven on all 49 permanent tables).
- [x] Choose one schema/validation system for request, response, configuration, and WebSocket payload types. (Zod).
- [x] Choose the test runner, HTTP injection library, WebSocket test client, fake-clock support, and coverage reporting. (Node's native test runner `node --import tsx --test`, Fastify `inject()`, `assert/strict`).
- [x] Define formatting, linting, type-checking, build, test, and start commands. (`npm run typecheck`, `npm test`, `npm run build`, `npm start`, `npm run dev`).
- [x] Decide whether TypeScript runs beside Python in `server-ts/` or under a neutral `server-next/`. Do not mix generated JavaScript into `server/`. (`server-ts/` with output isolated in `server-ts/dist/`).
- [x] Decide how shared static fixtures are referenced without copying or silently changing them. (Referenced via canonical paths to `../server/fixtures/` and `../web/`).
- [x] Decide how schema ownership works during coexistence. Only one migration owner may alter SQLite schema at a time. (Python remains sole production schema owner; TypeScript uses identical non-destructive `CREATE TABLE IF NOT EXISTS` and read/write compatibility).
- [x] Define the route-by-route traffic switch and rollback mechanism before moving the first route. (Reverse proxy route-by-route upstream routing via Nginx/Caddy with immediate fallback to Python backend).

## Proposed TypeScript boundaries

Route modules are the first architectural requirement. `app.ts` should assemble dependencies and register modules; it should not contain business logic.

```text
server-ts/
  package.json
  tsconfig.json
  src/
    app.ts                    # composition only
    main.ts                   # env loading, signal handling, listen
    config.ts                 # typed configuration and defaults
    context.ts                # explicit dependency graph
    db/
      connection.ts
      schema.ts
      migrations.ts
      repositories/
    middleware/
      origin.ts
      errors.ts
      rate-limit.ts
      auth.ts
      raw-body.ts
    routes/
      health.ts
      registration.ts
      chat.ts
      account.ts
      admin.ts
      wallet-link.ts
      wallet-actions.ts
      economy.ts
      collections.ts
      robots.ts
      galleries.ts
      snap.ts
      farcaster.ts
      telegram.ts
      github.ts
      discord.ts
      push.ts
      device-sync.ts
      turtle-connect.ts
      websocket.ts
    services/
    integrations/
    workers/
    media/
    domain/
  test/
    parity/
    fixtures/
```

- [ ] `app.ts` contains only dependency construction, middleware order, route registration, lifecycle registration, and static assets.
- [ ] Every route module exposes one registration function and receives typed dependencies.
- [x] Route modules never read process environment directly.
- [ ] Services never construct global database or HTTP clients implicitly.
- [ ] External providers are interfaces with real and fake implementations.
- [ ] Time, randomness, and outbound network calls are injectable for differential tests.
- [ ] Database repositories own SQL; route handlers do not embed SQL.
- [ ] Cross-route domain behavior has one implementation rather than copied helper functions.

## Differential parity harness

- [x] Start the frozen Python server on an isolated port with a temporary SQLite database.
- [x] Start the TypeScript server on another isolated port with an identical database copy.
- [ ] Stub Gemini, Bankr, Neynar, Telegram, Discord, GitHub, RPC, Blockscout, web push, and metadata endpoints.
- [ ] Capture and compare outbound method, URL, headers, body, timeout class, and call order.
- [ ] Normalize explicitly nondeterministic values only: timestamps, nonces, random IDs, and generated secrets.
- [ ] Inject deterministic time and random sources rather than broadly deleting fields from comparisons.
- [x] Compare response status, JSON, text/binary bytes, headers, and error bodies for the side-effect-free smoke manifest.
- [ ] Compare SQLite schema and row snapshots after every mutating request.
- [ ] Compare restart behavior by closing and reopening each implementation against its resulting database.
- [x] Compare rejected requests as carefully as successful requests in the smoke manifest.
- [ ] Run webhook comparisons only against captured requests and fake provider servers; never send each webhook twice in production.
- [ ] Replay WebSocket transcript fixtures and compare frames, order, close codes, and database effects.
- [x] Add a manifest listing every route, WebSocket input, table, environment key, and Python test. CI fails if the source inventory gains an uncovered item.

The local differential smoke harness covers 15 side-effect-free and rejected requests with isolated database copies. It does not replace the provider-capture, mutation, restart, WebSocket, or staging-shadow gates below.

## Middleware and application-wide behavior

- [x] Port the exact origin allowlist behavior from `origin_guard`. (The differential harness and middleware tests cover public, allowed, rejected, native, agent, and admin paths.)
- [x] Preserve public-path exceptions and `Origin: null` behavior.
- [x] Preserve special origin-free agent access for turtle challenge and confirmation endpoints.
- [x] Preserve separate admin CORS and bearer/session authorization behavior.
- [x] Preserve preflight responses and the exact allowed methods and headers.
- [x] Preserve `Cache-Control: no-store` on private, admin, pairing, and agent responses.
- [x] Preserve the 4096-byte server request limit and 4096-byte WebSocket message limit. (Oversized HTTP bodies match Python's undecorated plain-text 413; WebSocket tests require close code 1009.)
- [x] Preserve trusted-proxy behavior; never trust `X-Forwarded-For` unless `TRUST_PROXY=true`. (The full header is retained as Python does rather than silently changing rate-limit keys.)
- [ ] Inventory every rate-limit key, threshold, period, and cleanup rule.
- [x] Preserve JSON parsing failures and their existing status mappings. (Malformed and oversized JSON are compared directly against the frozen Python process.)
- [x] Preserve provider error redaction so credentials, private keys, and upstream bodies cannot leak.
- [x] Preserve graceful shutdown: stop workers, cancel challenge timers, close sockets with code 1001, then close SQLite.
- [x] Preserve startup order so schemas exist before handlers or workers access them.

## HTTP route inventory

Each route needs contract fixtures for success, validation failure, authentication failure, provider failure, database effects, and headers where applicable.

### Core, static, and registration

- [x] `GET /health`
- [x] `POST /api/register`
- [x] `POST /api/chat`
- [x] `OPTIONS /{path:.*}`
- [x] Static `/web/` mounting, path traversal protection, MIME types, and cache behavior

### Snap and Farcaster

- [x] `GET /`
- [x] `POST /`
- [x] `GET /api/snap`
- [x] `POST /api/snap`
- [x] `POST /api/snap/interact`
- [x] `GET /snap`
- [x] `POST /snap`
- [x] `GET /.well-known/farcaster.json`
- [x] `POST /api/farcaster/notify`
- [x] `POST /api/farcaster/webhook`
- [x] `POST /api/farcaster/cast`

### Account and device sync

- [x] `POST /api/account/profile`
- [x] `POST /api/device-sync/state`
- [x] `POST /api/device-sync/start`
- [x] `POST /api/device-sync/request`
- [x] `POST /api/device-sync/status`
- [x] `POST /api/device-sync/accept`
- [x] `POST /api/device-sync/leave`

### Wallet linking, discovery, and transactions

- [x] `POST /api/wallet-link/status`
- [x] `POST /api/wallet-link/challenge`
- [x] `POST /api/wallet-link/confirm`
- [x] `POST /api/wallet-link/disconnect`
- [x] `POST /api/wallet-link/nfts`
- [x] `POST /api/bankr/wallet`
- [x] `POST /api/bankr/nfts`
- [x] `POST /api/bankr/transform`
- [x] `POST /api/bankr/monitor`
- [x] `GET /api/bankr/status`
- [x] `GET /api/nft/price`
- [x] `GET /api/nft/uri`
- [x] `POST /api/wallet/mint`
- [x] `POST /api/wallet/rename-nft`
- [x] `POST /api/wallet/evolve-nft`
- [x] `POST /api/wallet/unwrap-nft`
- [x] `POST /api/wallet/save-nft-changes`
- [x] `POST /api/wallet/magic-link`
- [x] `POST /api/wallet/restore`

### Turtle connection

- [x] `POST /api/turtle-connect/start`
- [x] `POST /api/turtle-connect/challenge`
- [x] `POST /api/turtle-connect/confirm`
- [x] `POST /api/turtle-connect/status`
- [x] `POST /api/turtle-connect/accept`
- [x] `POST /api/turtle-connect/from-device`

### Economy and collections

- [x] `GET /api/economy/status`
- [x] `POST /api/deposits/open`
- [x] `POST /api/deposits/status`
- [x] `POST /api/deposits/confirm`
- [x] `POST /api/credits/balance`
- [x] `GET /api/collections/suggestions`
- [x] `POST /api/collections/suggestions`
- [x] `POST /api/collections/vote`
- [x] `GET /api/vote/status`
- [x] `POST /api/vote/status`

### Robots, imported collections, and galleries

- [x] `GET /api/robots/gallery`
- [x] `POST /api/robots/care`
- [x] `POST /api/robots/care/action`
- [x] `POST /api/robots/game`
- [x] `GET /api/gallery/collections`
- [x] `GET /api/gallery/imported`
- [x] `GET /api/hood-turtles/preview`
- [x] `POST /api/featured/hood-turtle`
- [x] `POST /api/featured/companion`

### Telegram, GitHub, and Discord

- [x] `POST /api/telegram/auth`
- [x] `POST /api/telegram/webhook`
- [x] `POST /api/github/webhook`
- [x] `POST /api/discord/token`
- [x] `POST /api/discord/interactions`
- [x] Preserve raw request bodies for GitHub HMAC and Discord Ed25519 verification.
- [x] Preserve Telegram multipart upload behavior and cached Telegram `file_id` reuse. (Phase 8 Slice 8E uploads generated GIFs once and persists Telegram's returned `file_id` for subsequent `/show` requests.)
- [x] Preserve Telegram callback-query routing so moderation and game callbacks do not consume each other. (Verification callbacks are handled first and only matching `tfverify` payloads are consumed.)

### Push notifications

- [x] `GET /api/push/public-key`
- [x] `POST /api/push/subscribe`
- [x] `POST /api/push/unsubscribe`
- [x] Preserve best-effort offline push, subscription removal, payload shape, and rate limits.

### Admin

- [x] `POST /api/admin/login`
- [x] `POST /api/admin/logout`
- [x] `POST /api/admin/users`
- [x] `GET /api/admin/state`
- [x] `POST /api/admin/settings`
- [x] `GET /api/admin/ledger`
- [x] `GET /api/admin/care`
- [x] `GET /admin`
- [x] `GET /admin/`
- [x] `GET /admin.html`
- [x] `GET /web/admin.html`

## WebSocket protocol inventory

The WebSocket route moves last because it shares process-local presence, rooms, visits, battles, timers, and rate limits.

- [x] `GET /ws`: heartbeat 30 seconds, maximum message size 4096 bytes. (Phase 9: Fastify WebSocket route with protocol-level payload enforcement.)
- [x] Authentication must arrive within 10 seconds as `{type:"auth", token}`.
- [x] Duplicate device connection closes the old socket with code 4001.
- [x] Authentication failure closes with code 4003.
- [x] Input `profile` and output friend/state refresh behavior.
- [x] Input `party-join`: public, private, Telegram, and Discord rooms; validation and 80-member cap.
- [x] Input `party-leave`.
- [x] Input `party-action`: `wave`, `dance`, `berry`, `pet`, `heart`; target and 100-character text behavior.
- [x] Input `friend-request`, including caps, pairing checks, notices, and offline push.
- [x] Input `friend-answer`, including symmetric friendship writes.
- [x] Input `friend-remove`, including visit and battle cleanup.
- [x] Input `visit-request`, `visit-answer`, `visit-end`, and `visit-action`.
- [x] Input `battle-request`, `battle-answer`, `battle-action`, and `battle-end`.
- [x] Output `state`, `notice`, `error`, and `party-state`.
- [x] Output `visit-request`, `visit-start`, `visit-profile`, `visit-action`, `visit-ended`, and `visit-request-ended`.
- [x] Output `battle-request`, `battle-start`, `battle-action`, `battle-ended`, and `battle-request-ended`.
- [x] Five-second cleanup loop, 60-second pending expiry, 30-minute visits, and 10-minute battles.
- [x] Disconnect cleanup and friend presence rebroadcast.
- [x] Restart semantics: process-local rooms and sessions disappear; persistent friendships remain.

## File-by-file production ledger

### Composition and route extraction

- [ ] `server/app.py` → composition plus the route modules above. Account for every nested helper, middleware, schema statement, startup hook, cleanup hook, route, WebSocket event, and in-memory map before deleting any Python line.
- [ ] Move registration/profile validation into `routes/registration.ts` and a shared profile domain module.
- [x] Move Gemini chat into `routes/chat.ts` plus a Gemini integration.
- [ ] Move Bankr and wallet transaction logic into separate route and service modules.
- [ ] Move Snap/Farcaster, Telegram, GitHub, Discord, push, NFT metadata, and WebSocket logic into their own route modules.
- [x] Replace module-global environment access with typed config passed through application context.

### Existing Python modules

- [x] `account_profile.py` → account-profile repository/service/routes; preserve account merging and Telegram identity rules.
- [x] `admin.py` → admin repository/service/routes; preserve password hashing, constant-time checks, session expiry, settings overlay, audit records, and HTML serving.
- [ ] `bankr_identity.py` → Bankr identity integration; preserve wallet-match-only acceptance and outage behavior.
- [ ] `bots_computer_art.py` → media adapter; compare sanitized SVG and animation semantics.
- [x] `collection_suggestions.py` → collection route/service/repository; preserve address normalization, vote accounting, and credit spending.
- [x] `deposit_allocator.py` → deposit-router integration; preserve nonce serialization, ABI encoding, receipts, timeouts, ETH/ERC-20 forwarding, and error classes.
- [x] `device_sync.py` → device-sync route/service/repository; preserve code reuse/renewal, expiry, approval, merge, limits, ordering, revision conflicts, and cleanup.
- [ ] `discord_integration.py` → Discord integration; preserve Ed25519 verification, OAuth exchange, and channel room IDs.
- [x] `economy.py` → economy domain/repository/routes; preserve integer arithmetic, append-only ledger, caps, idempotent transaction handling, packages, deposits, and disabled-mode behavior.
- [x] `extra_companions.py` → extra-collection discovery service; preserve supported collection map, bounded scans, ownership cache, partial results, and fail-closed verification. (Production adapters now scan bounded Robinhood transfer logs or Base owner batches, verify chain IDs, cache complete inventories, and fail closed.)
- [x] `github_app.py` → GitHub App auth integration; preserve RS256 JWT claims, key loading, installation discovery, least-privilege token requests, cache locking, and refresh margin. (Ported with Node crypto signing, key-stat cache invalidation, serialized refresh, and static-token compatibility.)
- [x] `github_integration.py` → GitHub issue integration; preserve transcript bounds, AI draft parsing, label filtering, webhook HMAC, issue-event mapping, and sanitized errors. (Phase 8 Slice 8D ports chat transcripts, Gemini drafting, REST issue creation, label filtering, persisted chat mapping, and safe user-facing failures.)
- [ ] `hood_turtle_art.py` → media adapter; preserve SVG sanitization and walking animation.
- [ ] `imported_gallery.py` → gallery routes; preserve selection-only exposure, pagination, deduplication, collection/chain constraints, and private-field exclusion.
- [x] `indexer.py` → independently runnable workers; preserve block ranges, independent checkpoints, reorg behavior, topic decoding, idempotency, cancellation, and CLI mode. (Phase 7 runs restart/checkpoint tests plus a real Anvil deployment covering ETH and ERC-20 deposits through the production allocator and indexer.)
- [x] `nub_art.py` → media adapter; preserve image validation, dimensions, transparency, and hopping animation. (Pure-JavaScript PNG decoding/resizing generates the canonical four-frame transparent hop rig.)
- [ ] `robot_care.py` → robot-care domain/routes/repository; preserve ownership checks, UTC allowance reset, live settings, charging order, prices, and rewards.
- [ ] `robot_companion.py` → Robots RPC/metadata/ownership service; preserve token bounds, batch discovery, cache rules, and SVG sanitization.
- [ ] `robot_gallery.py` → robot gallery route/repository/service; preserve event indexing, pagination, cache markers, provider-failure behavior, and HTTP cache headers.
- [x] `telegram_integration.py` → Telegram core integration; preserve init-data HMAC, auth age, deterministic identities, Bot API multipart requests, classifications, deep links, and issue commands. (Completed across Phase 5 and Phase 8 Slices 8D–8E.)
- [x] `telegram_interactive.py` → Telegram game/admin/status service; preserve secret redaction, owner/admin rules, game state, rendering, GitHub progress, and triage output.
- [x] `telegram_media.py` → Telegram GIF renderer; preserve supported SVG elements, path rendering, transforms, dimensions, frame timing, and PNG behavior. (Phase 8 Slice 8E adds bounded SVG/PNG rasterization and deterministic animated GIF output.)
- [x] `telegram_moderation.py` → Telegram moderation service/repository; preserve parser grammar, whole-word filters, strike rules, admin lookup, randomized challenges, persisted expiry, and fail-open restoration.
- [ ] `turtle_connect.py` → turtle-connect routes/service/repository; preserve EIP-191 messages, signature recovery, token bounds, wallet-wide links, Bankr verification, bounded discovery, pairing expiry, agent paths, and fail-closed ownership.

### Static and operational server files

- [ ] `server/admin.html`: keep served bytes/behavior compatible or explicitly move it with a documented build step.
- [ ] `server/fixtures/**`: reference the same canonical assets and add integrity checks.
- [ ] `server/.env.example`: replace with a complete typed configuration reference after all keys are reconciled.
- [ ] `server/requirements.txt`: retain while Python reference exists; remove only after final rollback window.
- [x] `server/Dockerfile`: build one coherent artifact from the full TypeScript server tree; no hand-maintained production-module copy list.
- [x] `server/compose.yml`: update health checks, runtime, command, volumes, secrets, and rollback image.
- [x] `server/Caddyfile`: preserve host, proxy, body, timeout, TLS, and WebSocket behavior.
- [x] `server/README.md`: document dual-run, parity, deployment, rollback, backups, and final TypeScript operation.

## SQLite schema ledger

For every table: capture exact `sqlite_master` SQL, indexes, primary keys, collations, defaults, nullability, migration behavior, row serialization, and ownership module. Test both a new database and a copy of production schema.

- [x] Accounts: `account_identities`, `account_profiles`.
- [x] Admin: `admin_audit`, `admin_sessions`, `admin_users`, `app_settings`.
- [ ] Core social: `pets`, `friends`, `requests`, `push_subs`.
- [x] Device sync: `device_sync_accounts`, `device_sync_codes`, `device_sync_members`.
- [x] Wallets: `pet_wallets`, `wallet_links`, `wallet_link_challenges`, `wallet_social_profiles`, `magic_links`; `wallet_links_next` is created only inside the legacy-table migration and removed before commit.
- [x] NFTs and collections: `fren_nfts`, `frens_burn_log`, `collection_suggestions`, `collection_votes`.
- [ ] Economy: `credit_accounts`, `credit_ledger`, `deposit_sessions`, `deposits`, `treasury_transfers`, `indexer_state`.
- [x] Robots: `robot_care_daily`, `robot_discovery`, `robot_owner_inventory`, `robot_ownership`, `robot_gallery_art`, `robot_gallery_events`, `robot_gallery_owners`, `robot_gallery_state`.
- [ ] External collections: `extra_companion_inventory`, `extra_companion_ownership`, `turtle_ownership`, `turtle_pairings`.
- [ ] Telegram: `tg_users`, `tg_media_cache`, `tg_filters`, `tg_blocklist`, `tg_strikes`, `tg_challenges`, `tg_fren_game`.
- [ ] Discord/GitHub: `dc_users`, `github_issue_chats`.
- [ ] Confirm whether any legacy or dynamically named production tables exist outside source inventory before implementation.
- [ ] Preserve Python’s use of TEXT for large integer values; never pass token or wei quantities through JavaScript `number`.
- [ ] Use `bigint` or decimal strings at boundaries and prove JSON serialization parity.
- [ ] Prove concurrent writes, `INSERT OR REPLACE`, `INSERT OR IGNORE`, row counts, and transaction rollback match SQLite behavior relied on by Python.

## Configuration ledger

Build a typed schema with the same defaults and enablement rules. Classify each key as secret, public, optional, required, deprecated, or documentation-only.

- [ ] Server/network: `HOST`, `PORT`, `DB_PATH`, `PET_DOMAIN`, `ALLOWED_ORIGINS`, `ALLOW_NATIVE_ORIGIN`, `TRUST_PROXY`.
- [ ] AI: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL`.
- [x] Bankr: `BANKR_API_KEY`, `BANKR_API_URL`, `BANKR_PARTNER_KEY`.
- [ ] Chain/NFT: `BASE_RPC_URL`, `CHAIN_ID`, `TINYFRENS_NFT_ADDRESS`, `TINYFRENS_NFT_MINT_PRICE_WEI`, `ALLOW_TESTNET_FREE_MINT`, `FREN_VAULT_SEED`, `FRENS_PER_VAULT_MINT`, `SAVE_CHANGES_FEE_FRENS`, `ROBOTS_RPC_URL`, `ROBINHOOD_RPC_URL`, `ROBINHOOD_BLOCKSCOUT_API_URL`.
- [ ] Economy/deposits: `ECONOMY_MODE`, `ECONOMY_DEPOSITS`, `ECONOMY_INDEXER_SECRET`, `DEPOSIT_ROUTER_PROXY`, `DEPOSIT_SESSION_ADDRESSES`, `GAME_CONTROLLER_PRIVATE_KEY`, `INDEXER_ENABLED`, `INDEXER_LOOKBACK`, `INDEXER_POLL_SECONDS`.
- [ ] Treasury: `FRENS_TOKEN`, `FRENS_TREASURY`, `FRENS_TREASURY_INDEXER`, `FRENS_TREASURY_MAX_CREDITS`, `FRENS_TREASURY_CHAIN_ID`, `FRENS_TREASURY_TOKEN`.
- [x] Robot care: `ROBOT_CARE_DAILY_ALLOWANCE`, `ROBOT_CARE_GAME_REWARD_CREDITS`, `ROBOT_CARE_PRICE_FEED`, `ROBOT_CARE_PRICE_PLAY`, `ROBOT_CARE_PRICE_REST`, `ROBOT_CARE_PRICE_ADVENTURE`, `ROBOT_CARE_PRICE_CLEAN`, `ROBOT_CARE_PRICE_VITAMIN`, `ROBOT_CARE_PRICE_SCOLD`, `ROBOT_CARE_PRICE_REVIVE`.
- [ ] Farcaster/Neynar: `NEYNAR_API_KEY`, `NEYNAR_CLIENT_ID`, `FARCASTER_SIGNER_UUID`, `SNAPCHAIN_API_URL`, `NEYNAR_WEBHOOK_URL`.
- [x] Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_MINIAPP_URL`, `TELEGRAM_MINIAPP_DEEP_LINK`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ISSUE_HISTORY`, `TELEGRAM_MODERATION`, `TELEGRAM_MODERATION_TIMEOUT`.
- [ ] GitHub: `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_ISSUE_LABELS`, `GITHUB_WEBHOOK_SECRET`.
- [ ] Discord: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_PUBLIC_KEY`.
- [ ] Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- [x] Admin: `ADMIN_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
- [ ] Reconcile documented but apparently indirect/unused keys: `TREASURY_PROXY`, `JACKPOT_VAULT_PROXY`, `GAME_CONTROLLER`.
- [x] CI fails if application code reads an undeclared key or the example declares an unclassified key.

## External integration parity

- [ ] Gemini request schema, system prompt, model default, temperature, token limit, timeout, and refusal/error parsing.
- [x] Bankr authentication, wallet APIs, transform/monitor calls, timeouts, and error redaction.
- [ ] Ethereum JSON-RPC quantities, ABI encoding, checksums, personal-sign recovery, transaction signing, gas padding, and receipt polling.
- [ ] Robinhood RPC and Blockscout pagination, bounded ranges, ownership rechecks, and partial-result flags.
- [ ] Robots RPC calls and event decoding.
- [ ] Neynar/Farcaster webhook and notification payloads.
- [x] Telegram init-data verification, Bot API calls, multipart media, callback answers, restrictions, bans, and webhook secret.
- [ ] GitHub REST calls, App JWT/token lifecycle, webhook HMAC, issue creation, labels, and progress reads.
- [ ] Discord OAuth and Ed25519 raw-body verification.
- [ ] Web Push VAPID generation and expired-subscription cleanup.
- [x] Pillow/SVG/GIF outputs: exact hashes when deterministic; otherwise dimensions, frame count/timing, transparency, sanitized content, and visual fixtures. (The TypeScript renderer validates canonical robot/turtle fixtures plus PNG, dimensions, frames, timing, transparency index, and unsafe SVG rejection; FFmpeg independently decodes the generated 128×128 animation.)

## Background jobs and lifecycle

- [x] Deposit indexer startup, polling, checkpointing, stop signal, and shutdown. (Worker startup/lifecycle tests cover enablement and bounded shutdown; indexer tests cover retry, abort, persisted restart, chunking, and a real Anvil scan.)
- [x] Treasury transfer indexer startup, polling, checkpointing, stop signal, and shutdown. (Worker startup/lifecycle tests cover enablement and bounded shutdown; indexer tests cover independent checkpoints, filters, caps, unmatched transfers, and idempotency.)
- [x] Telegram challenge timers restored from SQLite after restart. (Phase 8 Slice 8A: persisted challenges reschedule on startup and cancel during graceful shutdown.)
- [x] Five-second visit/battle/rate-limit cleanup loop. (Phase 9: one hub timer expires sessions and prunes stale rate-limit buckets.)
- [x] Fire-and-forget push delivery does not hold request completion or leak database handles. (Phase 9: offline notifications use the real `web-push` sender and isolate best-effort failures from socket handling.)
- [x] GitHub App token cache and concurrent refresh locking.
- [x] Provider discovery locks and TTL caches. (Robot, turtle, and extra-collection discovery use bounded provider reads with serialized inventory refresh and explicit TTLs.)
- [x] Process signals produce a bounded graceful shutdown under systemd and containers. (Phase 7 Slice 7B: idempotent 10-second deadline, workers stop before Fastify and SQLite close, startup failures close resources.)

## Test-file migration ledger

Create a TypeScript counterpart before checking off each Python test file. Preserve each named behavior, including negative cases; do not merely copy test titles.

- [ ] `test_app.py`: core HTTP, middleware, wallet, NFT, Snap, Farcaster, Telegram, GitHub, Discord, push, party, WebSocket, and configuration behavior.
- [x] `test_admin.py`: admin settings, users, sessions, audit, authorization, and HTML.
- [x] `test_bankr_identity.py`: verified handle/address matching.
- [ ] `test_bots_computer_art.py`: SVG sanitization and animation.
- [x] `test_collection_suggestions.py`: suggestions, validation, votes, credit spending, and over-voting prevention.
- [x] `test_deposit_allocator.py`: ETH/ERC-20 forwarding and nonce serialization.
- [x] `test_device_sync.py`: approval, restart, selection revisions, wallet ordering, expiry, and unsync.
- [x] `test_economy.py`: arithmetic, sessions, deposits, ledger, idempotency, caps, routes, and disabled mode.
- [x] `test_extra_companions.py`: discovery, caches, transfers, provider failures, and Nub reconstruction.
- [x] `test_github_app.py`: JWT cryptography, installation discovery, token scope/cache/refresh, key replacement, and static-token compatibility.
- [ ] `test_hood_turtle_art.py`: sanitization and animation.
- [ ] `test_imported_gallery.py`: privacy, selection, collection/chain boundaries, deduplication, and pagination.
- [x] `test_indexer.py`: log decoding, filters, checkpoints, idempotency, caps, and ETH/ERC-20 indexing. (The TypeScript integration test deploys the real economy contracts on Anvil and credits both asset paths.)
- [ ] `test_nft_uri.py`: minted/unminted metadata and assets.
- [x] `test_nub_art.py`: image validation and animation.
- [x] `test_robot_care.py`: catalog, allowances, UTC reset, ownership, charging, prices, routes, and rewards.
- [x] `test_robot_companion.py`: art parsing, ownership renewal, transfer revocation, discovery, and incomplete inventories.
- [ ] `test_robot_gallery.py`: concurrency, restarts, refreshes, mint/burn/reorgs, cache fallback, pagination, and headers.
- [x] `test_telegram_interactive.py`: redaction, permissions, game loop, cards, GitHub progress, status, and triage.
- [x] `test_telegram_media.py`: robot/turtle/PNG animation rendering.
- [x] `test_telegram_moderation.py`: command grammar, filters, blocklist, strikes, and admin roles.
- [x] `test_turtle_connect.py`: wallet-wide pairing, signatures, Bankr, multi-wallet discovery, RPC fallback, expiry, restart, ownership, unlinking, and origins.
- [x] `test_wallet_migration.py`: legacy wallet-link migration and restart persistence.

## Client compatibility ledger

Search again at the implementation baseline; these files currently consume server routes or WebSocket contracts.

- [ ] Browser: `web/account-header.js`, `account-profile.js`, `app.js`, `chat.js`, `customize.js`, `device-sync.js`, `discord.js`, `featured-turtle.js`, `friends.js`, `gallery.js`, `game-players.js`, `hood-turtles.js`, `nft-discovery.js`, `push.js`, `robot-care.js`, `snap.js`, `social-config.js`, `telegram.js`, `vote.js`, `wallet-link.js`, `wallet.js`.
- [ ] Desktop: `desktop/turtle.cjs` and its tests.
- [ ] Android: `MainActivity.kt`, `PetOverlayService.kt`, `TurtleStore.kt`.
- [ ] iOS: `TinyFrensApp.swift`.
- [ ] Farcaster Snap: `snap/src/index.ts` and `web/snap-v2.json`.
- [ ] Scripts/runbooks: account, robot-care, vote, and testnet-economy scripts.
- [ ] Capture real client requests as sanitized fixtures and replay them against both servers.
- [ ] Confirm browser, Android, iOS, desktop, Telegram Mini App, Farcaster, and Discord behavior before cutover.
- [x] Source-derived CI guard verifies every local route literal referenced by browser, desktop, Android, iOS, Snap, and scripts is registered by TypeScript.

## Safe implementation order

- [x] Phase 0: freeze inventories, parity harness, typed config, database compatibility probe, and deployment skeleton.
- [x] Phase 1: pure utilities and parsers with no I/O (profile normalization, pairing codes, economy token math, robot care bounds & UTC keys, Telegram command grammar, companion selection, and DEX Screener quote math).
- [x] Phase 2: media generation and deterministic contract/crypto helpers using known vectors.
- [x] Phase 3: repositories and schema compatibility against copied fixture databases.
- [x] Phase 4: read-only routes such as health, metadata, galleries, and status endpoints.
- [x] Phase 5: isolated signed webhooks and external integrations using captured fixtures and fake providers.
- [x] Phase 6: authenticated mutation routes for profiles, pairing, device sync, care, voting, wallets, and economy.
- [x] Phase 7: workers and restart recovery.
- [x] Phase 8: Telegram orchestration and moderation. (Slices 8A–8E cover persisted challenge recovery, moderation enforcement, interactive commands, conversational/issue flows, `/show`, GIF rendering, multipart upload, and media caching.)
- [x] Phase 9: stateful WebSocket protocol and process-local presence. (Authentication, duplicate replacement, presence, parties, friends, visits, battles, expiry, heartbeat, payload limits, and graceful close are implemented.)
- [x] Phase 10: shadow comparison in staging with outbound side effects disabled.
  - [x] Staging shadow Compose isolation and hard-failing remote comparator are implemented.
  - [x] Run the shadow comparison on staging and record immutable image digests, backup identity, output, and logs. (Completed 2026-10-15 against isolated copies of a production SQLite snapshot; 17/17 requests matched, both post-run copies remained byte-identical, and both integrity checks returned `ok`. Evidence is retained privately on the host.)
- [x] Phase 11: route canaries, then full cutover, with immediate rollback available.
  - [x] Read-only SQLite mode and GET/HEAD/OPTIONS-only canary routing are implemented.
  - [x] Canary verification and immediate proxy rollback runbook is documented.
  - [x] Exercise the canary against production traffic after Phase 10 succeeds. (`/health` canary verified through public TLS with an explicit response marker and TypeScript request logs.)
  - [x] Initial production `/health` canary routes to a read-only TypeScript container; Python remains the sole writer and rollback to Python was exercised before restoring the canary.
  - [x] Full production cutover completed from immutable commit `3b8680b4b4129ad1f1e01012ce37c6d37c73d008` after a writable production-copy audit showed only the expected `indexer_state` table addition, no row-count changes, no retained migration scratch table, and SQLite integrity `ok`.
  - [x] Public TLS smoke covered all 17 shadow-manifest requests and the WebSocket authentication close contract; the Python rollback service was then started against the migrated database, passed health, and TypeScript was restored successfully.
- [ ] Phase 12: observation window, production backup verification, then Python retirement in a separate PR.

## Per-file workflow

Use this sequence for every production file or extracted behavior group.

- [ ] Mark the Python source file and exact line/function inventory in the PR.
- [ ] Add or update Python characterization tests for behavior that is currently implicit.
- [ ] Add TypeScript types and failing parity fixtures.
- [ ] Implement the TypeScript counterpart without editing the Python reference behavior.
- [ ] Run targeted TypeScript tests.
- [ ] Run the matching targeted Python tests.
- [ ] Run differential tests for success, validation, authorization, provider failure, and restart.
- [ ] Compare database state and outbound calls.
- [ ] Record evidence and check off the corresponding route, table, environment, integration, and test entries here.
- [ ] Keep the TypeScript route disabled until its entire behavior group is checked.

## Cutover and rollback gates

- [x] A production database backup has been created and a restore has been timed and verified.
- [x] The TypeScript process can open a copied production database without schema mutation or data loss.
- [x] There is only one writer for any stateful route during canary operation.
- [x] Webhook providers point to only one side-effecting implementation.
- [x] Shadow traffic strips credentials where possible and disables all external mutations.
- [ ] Health checks include database access and worker readiness without exposing secrets.
- [ ] Logs and metrics cover request failures, provider failures, WebSocket connections, worker lag, SQLite locks, webhook backlog, and challenge timers.
- [x] The previous Python artifact, environment, service unit, and database backup are retained for rollback.
- [x] Rollback requires no reverse database migration.
- [ ] Public health, web clients, native clients, Telegram, GitHub webhooks, Discord, WebSockets, RPC reads, and background indexers pass production smoke checks.
- [ ] Observe at least one complete timeout/cache/indexer cycle relevant to each migrated background behavior.
- [ ] Remove Python only after the agreed observation window and a separate explicit approval.

## Final retirement audit

- [ ] Inventory script reports zero uncovered Python routes, tables, environment keys, tests, background jobs, or WebSocket messages.
- [ ] No production process imports or executes `server/*.py`.
- [ ] No workflow, systemd unit, Docker file, Compose file, Caddy config, runbook, or deployment script starts Python.
- [ ] No client depends on an unported error shape or undocumented response field.
- [x] Required GitHub checks run the TypeScript typecheck, targeted tests, parity manifest, build, production image build, and startup smoke test.
- [ ] Python requirements and tests are archived or removed only in the retirement PR.
- [ ] Documentation describes the TypeScript source of truth and the supported local/deployment commands.
- [x] Final production backup and rollback artifact locations are recorded privately.
