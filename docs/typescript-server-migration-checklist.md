# Python-to-TypeScript server migration checklist

Status: planning only. This document does not authorize removing, replacing, or changing production Python behavior.

Baseline: update this field to the exact commit used when implementation begins: `PYTHON_REFERENCE_COMMIT=0f03d36d926fab4b24efa3f81d9a7b395646ee69`.

## Completion rules

A box may be checked only when the TypeScript implementation has been compared with the frozen Python reference and the evidence is linked in the migration PR.

- [ ] Same accepted inputs, normalization, defaults, limits, and validation errors.
- [x] Same HTTP status, response body, content type, cache headers, and CORS behavior (verified for GET /health and origin guard).
- [ ] Same authentication, authorization, signature verification, and rate limits.
- [x] Same SQLite schema, values, ordering, transaction boundaries, idempotency, and restart behavior (verified for all 50 tables across modules).
- [ ] Same external requests, timeouts, retry behavior, and fail-closed/fail-open behavior.
- [ ] Same WebSocket frames, close codes, ordering, expiry, and reconnect behavior where applicable.
- [ ] Same background work, cancellation, cleanup, and graceful shutdown behavior.
- [x] Existing Python tests have equivalent TypeScript tests; tests run real assertions and real tools.
- [x] A differential parity test passes against both implementations using the same fixture, clock, random values, and mocked providers.
- [x] No production traffic or secrets are used by the parity harness.
- [x] Python remains the production authority until the cutover checklist is complete.

“Implemented” and “parity verified” are separate states. A translated file is not complete merely because it compiles.

## Decisions to freeze before implementation

- [x] Record the Python reference commit and prevent behavior changes from entering it unnoticed. (`PYTHON_REFERENCE_COMMIT=0f03d36d926fab4b24efa3f81d9a7b395646ee69`)
- [x] Choose the TypeScript runtime: Node 22 or Bun. Record the production runtime and package manager. (Node 22 LTS with npm, matching CI, existing scripts, and host environment).
- [x] Choose the HTTP framework after proving WebSocket, raw-body webhook verification, multipart Telegram uploads, cleanup hooks, and streaming behavior. (Fastify with `@fastify/websocket`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/multipart`, and `fastify-raw-body`).
- [x] Choose the SQLite driver and prove compatibility with the existing database file, WAL/locking behavior, integer handling, collations, and transactions. (`better-sqlite3` via abstract `DatabaseConnection` with WAL, busy_timeout=5000, foreign_keys=ON; compatibility proven on all 50 tables).
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
- [ ] Route modules never read process environment directly.
- [ ] Services never construct global database or HTTP clients implicitly.
- [ ] External providers are interfaces with real and fake implementations.
- [ ] Time, randomness, and outbound network calls are injectable for differential tests.
- [ ] Database repositories own SQL; route handlers do not embed SQL.
- [ ] Cross-route domain behavior has one implementation rather than copied helper functions.

## Differential parity harness

- [ ] Start the frozen Python server on an isolated port with a temporary SQLite database.
- [ ] Start the TypeScript server on another isolated port with an identical database copy.
- [ ] Stub Gemini, Bankr, Neynar, Telegram, Discord, GitHub, RPC, Blockscout, web push, and metadata endpoints.
- [ ] Capture and compare outbound method, URL, headers, body, timeout class, and call order.
- [ ] Normalize explicitly nondeterministic values only: timestamps, nonces, random IDs, and generated secrets.
- [ ] Inject deterministic time and random sources rather than broadly deleting fields from comparisons.
- [ ] Compare response status, JSON, text/binary bytes, headers, and error bodies.
- [ ] Compare SQLite schema and row snapshots after every mutating request.
- [ ] Compare restart behavior by closing and reopening each implementation against its resulting database.
- [ ] Compare rejected requests as carefully as successful requests.
- [ ] Run webhook comparisons only against captured requests and fake provider servers; never send each webhook twice in production.
- [ ] Replay WebSocket transcript fixtures and compare frames, order, close codes, and database effects.
- [ ] Add a manifest listing every route, WebSocket input, table, environment key, and Python test. CI fails if the source inventory gains an uncovered item.

## Middleware and application-wide behavior

- [ ] Port the exact origin allowlist behavior from `origin_guard`.
- [ ] Preserve public-path exceptions and `Origin: null` behavior.
- [ ] Preserve special origin-free agent access for turtle challenge and confirmation endpoints.
- [ ] Preserve separate admin CORS and bearer/session authorization behavior.
- [ ] Preserve preflight responses and the exact allowed methods and headers.
- [ ] Preserve `Cache-Control: no-store` on private, admin, pairing, and agent responses.
- [ ] Preserve the 4096-byte server request limit and 4096-byte WebSocket message limit.
- [ ] Preserve trusted-proxy behavior; never trust `X-Forwarded-For` unless `TRUST_PROXY=true`.
- [ ] Inventory every rate-limit key, threshold, period, and cleanup rule.
- [ ] Preserve JSON parsing failures and their existing status mappings.
- [ ] Preserve provider error redaction so credentials, private keys, and upstream bodies cannot leak.
- [ ] Preserve graceful shutdown: stop workers, cancel challenge timers, close sockets with code 1001, then close SQLite.
- [ ] Preserve startup order so schemas exist before handlers or workers access them.

## HTTP route inventory

Each route needs contract fixtures for success, validation failure, authentication failure, provider failure, database effects, and headers where applicable.

### Core, static, and registration

- [x] `GET /health`
- [ ] `POST /api/register`
- [ ] `POST /api/chat`
- [ ] `OPTIONS /{path:.*}`
- [ ] Static `/web/` mounting, path traversal protection, MIME types, and cache behavior

### Snap and Farcaster

- [ ] `GET /`
- [ ] `POST /`
- [ ] `GET /api/snap`
- [ ] `POST /api/snap`
- [ ] `POST /api/snap/interact`
- [ ] `GET /snap`
- [ ] `POST /snap`
- [ ] `GET /.well-known/farcaster.json`
- [ ] `POST /api/farcaster/notify`
- [ ] `POST /api/farcaster/webhook`
- [ ] `POST /api/farcaster/cast`

### Account and device sync

- [ ] `POST /api/account/profile`
- [ ] `POST /api/device-sync/state`
- [ ] `POST /api/device-sync/start`
- [ ] `POST /api/device-sync/request`
- [ ] `POST /api/device-sync/status`
- [ ] `POST /api/device-sync/accept`
- [ ] `POST /api/device-sync/leave`

### Wallet linking, discovery, and transactions

- [ ] `POST /api/wallet-link/status`
- [ ] `POST /api/wallet-link/challenge`
- [ ] `POST /api/wallet-link/confirm`
- [ ] `POST /api/wallet-link/disconnect`
- [ ] `POST /api/wallet-link/nfts`
- [ ] `POST /api/bankr/wallet`
- [ ] `POST /api/bankr/nfts`
- [ ] `POST /api/bankr/transform`
- [ ] `POST /api/bankr/monitor`
- [ ] `GET /api/bankr/status`
- [ ] `GET /api/nft/price`
- [ ] `GET /api/nft/uri`
- [ ] `POST /api/wallet/mint`
- [ ] `POST /api/wallet/rename-nft`
- [ ] `POST /api/wallet/evolve-nft`
- [ ] `POST /api/wallet/unwrap-nft`
- [ ] `POST /api/wallet/save-nft-changes`
- [ ] `POST /api/wallet/magic-link`
- [ ] `POST /api/wallet/restore`

### Turtle connection

- [ ] `POST /api/turtle-connect/start`
- [ ] `POST /api/turtle-connect/challenge`
- [ ] `POST /api/turtle-connect/confirm`
- [ ] `POST /api/turtle-connect/status`
- [ ] `POST /api/turtle-connect/accept`
- [ ] `POST /api/turtle-connect/from-device`

### Economy and collections

- [ ] `GET /api/economy/status`
- [ ] `POST /api/deposits/open`
- [ ] `POST /api/deposits/status`
- [ ] `POST /api/deposits/confirm`
- [ ] `POST /api/credits/balance`
- [ ] `GET /api/collections/suggestions`
- [ ] `POST /api/collections/suggestions`
- [ ] `POST /api/collections/vote`
- [ ] `GET /api/vote/status`
- [ ] `POST /api/vote/status`

### Robots, imported collections, and galleries

- [ ] `GET /api/robots/gallery`
- [ ] `POST /api/robots/care`
- [ ] `POST /api/robots/care/action`
- [ ] `POST /api/robots/game`
- [ ] `GET /api/gallery/collections`
- [ ] `GET /api/gallery/imported`
- [ ] `GET /api/hood-turtles/preview`
- [ ] `POST /api/featured/hood-turtle`
- [ ] `POST /api/featured/companion`

### Telegram, GitHub, and Discord

- [ ] `POST /api/telegram/auth`
- [ ] `POST /api/telegram/webhook`
- [ ] `POST /api/github/webhook`
- [ ] `POST /api/discord/token`
- [ ] `POST /api/discord/interactions`
- [ ] Preserve raw request bodies for GitHub HMAC and Discord Ed25519 verification.
- [ ] Preserve Telegram multipart upload behavior and cached Telegram `file_id` reuse.
- [ ] Preserve Telegram callback-query routing so moderation and game callbacks do not consume each other.

### Push notifications

- [ ] `GET /api/push/public-key`
- [ ] `POST /api/push/subscribe`
- [ ] `POST /api/push/unsubscribe`
- [ ] Preserve best-effort offline push, subscription removal, payload shape, and rate limits.

### Admin

- [ ] `POST /api/admin/login`
- [ ] `POST /api/admin/logout`
- [ ] `POST /api/admin/users`
- [ ] `GET /api/admin/state`
- [ ] `POST /api/admin/settings`
- [ ] `GET /api/admin/ledger`
- [ ] `GET /api/admin/care`
- [ ] `GET /admin`
- [ ] `GET /admin/`
- [ ] `GET /admin.html`
- [ ] `GET /web/admin.html`

## WebSocket protocol inventory

The WebSocket route moves last because it shares process-local presence, rooms, visits, battles, timers, and rate limits.

- [ ] `GET /ws`: heartbeat 30 seconds, maximum message size 4096 bytes.
- [ ] Authentication must arrive within 10 seconds as `{type:"auth", token}`.
- [ ] Duplicate device connection closes the old socket with code 4001.
- [ ] Authentication failure closes with code 4003.
- [ ] Input `profile` and output friend/state refresh behavior.
- [ ] Input `party-join`: public, private, Telegram, and Discord rooms; validation and 80-member cap.
- [ ] Input `party-leave`.
- [ ] Input `party-action`: `wave`, `dance`, `berry`, `pet`, `heart`; target and 100-character text behavior.
- [ ] Input `friend-request`, including caps, pairing checks, notices, and offline push.
- [ ] Input `friend-answer`, including symmetric friendship writes.
- [ ] Input `friend-remove`, including visit and battle cleanup.
- [ ] Input `visit-request`, `visit-answer`, `visit-end`, and `visit-action`.
- [ ] Input `battle-request`, `battle-answer`, `battle-action`, and `battle-end`.
- [ ] Output `state`, `notice`, `error`, and `party-state`.
- [ ] Output `visit-request`, `visit-start`, `visit-profile`, `visit-action`, `visit-ended`, and `visit-request-ended`.
- [ ] Output `battle-request`, `battle-start`, `battle-action`, `battle-ended`, and `battle-request-ended`.
- [ ] Five-second cleanup loop, 60-second pending expiry, 30-minute visits, and 10-minute battles.
- [ ] Disconnect cleanup and friend presence rebroadcast.
- [ ] Restart semantics: process-local rooms and sessions disappear; persistent friendships remain.

## File-by-file production ledger

### Composition and route extraction

- [ ] `server/app.py` → composition plus the route modules above. Account for every nested helper, middleware, schema statement, startup hook, cleanup hook, route, WebSocket event, and in-memory map before deleting any Python line.
- [ ] Move registration/profile validation into `routes/registration.ts` and a shared profile domain module.
- [ ] Move Gemini chat into `routes/chat.ts` plus a Gemini integration.
- [ ] Move Bankr and wallet transaction logic into separate route and service modules.
- [ ] Move Snap/Farcaster, Telegram, GitHub, Discord, push, NFT metadata, and WebSocket logic into their own route modules.
- [ ] Replace module-global environment access with typed config passed through application context.

### Existing Python modules

- [ ] `account_profile.py` → account-profile repository/service/routes; preserve account merging and Telegram identity rules.
- [ ] `admin.py` → admin repository/service/routes; preserve password hashing, constant-time checks, session expiry, settings overlay, audit records, and HTML serving.
- [ ] `bankr_identity.py` → Bankr identity integration; preserve wallet-match-only acceptance and outage behavior.
- [ ] `bots_computer_art.py` → media adapter; compare sanitized SVG and animation semantics.
- [ ] `collection_suggestions.py` → collection route/service/repository; preserve address normalization, vote accounting, and credit spending.
- [ ] `deposit_allocator.py` → deposit-router integration; preserve nonce serialization, ABI encoding, receipts, timeouts, ETH/ERC-20 forwarding, and error classes.
- [ ] `device_sync.py` → device-sync route/service/repository; preserve code reuse/renewal, expiry, approval, merge, limits, ordering, revision conflicts, and cleanup.
- [ ] `discord_integration.py` → Discord integration; preserve Ed25519 verification, OAuth exchange, and channel room IDs.
- [ ] `economy.py` → economy domain/repository/routes; preserve integer arithmetic, append-only ledger, caps, idempotent transaction handling, packages, deposits, and disabled-mode behavior.
- [ ] `extra_companions.py` → extra-collection discovery service; preserve supported collection map, bounded scans, ownership cache, partial results, and fail-closed verification.
- [ ] `github_app.py` → GitHub App auth integration; preserve RS256 JWT claims, key loading, installation discovery, least-privilege token requests, cache locking, and refresh margin.
- [ ] `github_integration.py` → GitHub issue integration; preserve transcript bounds, AI draft parsing, label filtering, webhook HMAC, issue-event mapping, and sanitized errors.
- [ ] `hood_turtle_art.py` → media adapter; preserve SVG sanitization and walking animation.
- [ ] `imported_gallery.py` → gallery routes; preserve selection-only exposure, pagination, deduplication, collection/chain constraints, and private-field exclusion.
- [ ] `indexer.py` → independently runnable workers; preserve block ranges, independent checkpoints, reorg behavior, topic decoding, idempotency, cancellation, and CLI mode.
- [ ] `nub_art.py` → media adapter; preserve image validation, dimensions, transparency, and hopping animation.
- [ ] `robot_care.py` → robot-care domain/routes/repository; preserve ownership checks, UTC allowance reset, live settings, charging order, prices, and rewards.
- [ ] `robot_companion.py` → Robots RPC/metadata/ownership service; preserve token bounds, batch discovery, cache rules, and SVG sanitization.
- [ ] `robot_gallery.py` → robot gallery route/repository/service; preserve event indexing, pagination, cache markers, provider-failure behavior, and HTTP cache headers.
- [ ] `telegram_integration.py` → Telegram core integration; preserve init-data HMAC, auth age, deterministic identities, Bot API multipart requests, classifications, deep links, and issue commands.
- [ ] `telegram_interactive.py` → Telegram game/admin/status service; preserve secret redaction, owner/admin rules, game state, rendering, GitHub progress, and triage output.
- [ ] `telegram_media.py` → Telegram GIF renderer; preserve supported SVG elements, path rendering, transforms, dimensions, frame timing, and PNG behavior.
- [ ] `telegram_moderation.py` → Telegram moderation service/repository; preserve parser grammar, whole-word filters, strike rules, admin lookup, randomized challenges, persisted expiry, and fail-open restoration.
- [ ] `turtle_connect.py` → turtle-connect routes/service/repository; preserve EIP-191 messages, signature recovery, token bounds, wallet-wide links, Bankr verification, bounded discovery, pairing expiry, agent paths, and fail-closed ownership.

### Static and operational server files

- [ ] `server/admin.html`: keep served bytes/behavior compatible or explicitly move it with a documented build step.
- [ ] `server/fixtures/**`: reference the same canonical assets and add integrity checks.
- [ ] `server/.env.example`: replace with a complete typed configuration reference after all keys are reconciled.
- [ ] `server/requirements.txt`: retain while Python reference exists; remove only after final rollback window.
- [ ] `server/Dockerfile`: build one coherent artifact from the full TypeScript server tree; no hand-maintained production-module copy list.
- [ ] `server/compose.yml`: update health checks, runtime, command, volumes, secrets, and rollback image.
- [ ] `server/Caddyfile`: preserve host, proxy, body, timeout, TLS, and WebSocket behavior.
- [ ] `server/README.md`: document dual-run, parity, deployment, rollback, backups, and final TypeScript operation.

## SQLite schema ledger

For every table: capture exact `sqlite_master` SQL, indexes, primary keys, collations, defaults, nullability, migration behavior, row serialization, and ownership module. Test both a new database and a copy of production schema.

- [ ] Accounts: `account_identities`, `account_profiles`.
- [ ] Admin: `admin_audit`, `admin_sessions`, `admin_users`, `app_settings`.
- [ ] Core social: `pets`, `friends`, `requests`, `push_subs`.
- [ ] Device sync: `device_sync_accounts`, `device_sync_codes`, `device_sync_members`.
- [ ] Wallets: `pet_wallets`, `wallet_links`, `wallet_links_next`, `wallet_link_challenges`, `wallet_social_profiles`, `magic_links`.
- [ ] NFTs and collections: `fren_nfts`, `frens_burn_log`, `collection_suggestions`, `collection_votes`.
- [ ] Economy: `credit_accounts`, `credit_ledger`, `deposit_sessions`, `deposits`, `treasury_transfers`, `indexer_state`.
- [ ] Robots: `robot_care_daily`, `robot_discovery`, `robot_owner_inventory`, `robot_ownership`, `robot_gallery_art`, `robot_gallery_events`, `robot_gallery_owners`, `robot_gallery_state`.
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
- [ ] Bankr: `BANKR_API_KEY`, `BANKR_API_URL`, `BANKR_PARTNER_KEY`.
- [ ] Chain/NFT: `BASE_RPC_URL`, `CHAIN_ID`, `TINYFRENS_NFT_ADDRESS`, `TINYFRENS_NFT_MINT_PRICE_WEI`, `ALLOW_TESTNET_FREE_MINT`, `FREN_VAULT_SEED`, `FRENS_PER_VAULT_MINT`, `SAVE_CHANGES_FEE_FRENS`, `ROBOTS_RPC_URL`, `ROBINHOOD_RPC_URL`, `ROBINHOOD_BLOCKSCOUT_API_URL`.
- [ ] Economy/deposits: `ECONOMY_MODE`, `ECONOMY_DEPOSITS`, `ECONOMY_INDEXER_SECRET`, `DEPOSIT_ROUTER_PROXY`, `DEPOSIT_SESSION_ADDRESSES`, `GAME_CONTROLLER_PRIVATE_KEY`, `INDEXER_ENABLED`, `INDEXER_LOOKBACK`, `INDEXER_POLL_SECONDS`.
- [ ] Treasury: `FRENS_TOKEN`, `FRENS_TREASURY`, `FRENS_TREASURY_INDEXER`, `FRENS_TREASURY_MAX_CREDITS`, `FRENS_TREASURY_CHAIN_ID`, `FRENS_TREASURY_TOKEN`.
- [ ] Robot care: `ROBOT_CARE_DAILY_ALLOWANCE`, `ROBOT_CARE_GAME_REWARD_CREDITS`, `ROBOT_CARE_PRICE_FEED`, `ROBOT_CARE_PRICE_PLAY`, `ROBOT_CARE_PRICE_REST`, `ROBOT_CARE_PRICE_ADVENTURE`, `ROBOT_CARE_PRICE_CLEAN`, `ROBOT_CARE_PRICE_VITAMIN`, `ROBOT_CARE_PRICE_SCOLD`, `ROBOT_CARE_PRICE_REVIVE`.
- [ ] Farcaster/Neynar: `NEYNAR_API_KEY`, `NEYNAR_CLIENT_ID`, `FARCASTER_SIGNER_UUID`, `SNAPCHAIN_API_URL`, `NEYNAR_WEBHOOK_URL`.
- [ ] Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_MINIAPP_URL`, `TELEGRAM_MINIAPP_DEEP_LINK`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ISSUE_HISTORY`, `TELEGRAM_MODERATION`, `TELEGRAM_MODERATION_TIMEOUT`.
- [ ] GitHub: `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_ISSUE_LABELS`, `GITHUB_WEBHOOK_SECRET`.
- [ ] Discord: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_PUBLIC_KEY`.
- [ ] Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- [ ] Admin: `ADMIN_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
- [ ] Reconcile documented but apparently indirect/unused keys: `TREASURY_PROXY`, `JACKPOT_VAULT_PROXY`, `GAME_CONTROLLER`.
- [ ] CI fails if application code reads an undeclared key or the example declares an unclassified key.

## External integration parity

- [ ] Gemini request schema, system prompt, model default, temperature, token limit, timeout, and refusal/error parsing.
- [ ] Bankr authentication, wallet APIs, transform/monitor calls, timeouts, and error redaction.
- [ ] Ethereum JSON-RPC quantities, ABI encoding, checksums, personal-sign recovery, transaction signing, gas padding, and receipt polling.
- [ ] Robinhood RPC and Blockscout pagination, bounded ranges, ownership rechecks, and partial-result flags.
- [ ] Robots RPC calls and event decoding.
- [ ] Neynar/Farcaster webhook and notification payloads.
- [ ] Telegram init-data verification, Bot API calls, multipart media, callback answers, restrictions, bans, and webhook secret.
- [ ] GitHub REST calls, App JWT/token lifecycle, webhook HMAC, issue creation, labels, and progress reads.
- [ ] Discord OAuth and Ed25519 raw-body verification.
- [ ] Web Push VAPID generation and expired-subscription cleanup.
- [ ] Pillow/SVG/GIF outputs: exact hashes when deterministic; otherwise dimensions, frame count/timing, transparency, sanitized content, and visual fixtures.

## Background jobs and lifecycle

- [ ] Deposit indexer startup, polling, checkpointing, stop signal, and shutdown.
- [ ] Treasury transfer indexer startup, polling, checkpointing, stop signal, and shutdown.
- [ ] Telegram challenge timers restored from SQLite after restart.
- [ ] Five-second visit/battle/rate-limit cleanup loop.
- [ ] Fire-and-forget push delivery does not hold request completion or leak database handles.
- [ ] GitHub App token cache and concurrent refresh locking.
- [ ] Provider discovery locks and TTL caches.
- [ ] Process signals produce a bounded graceful shutdown under systemd and containers.

## Test-file migration ledger

Create a TypeScript counterpart before checking off each Python test file. Preserve each named behavior, including negative cases; do not merely copy test titles.

- [ ] `test_app.py`: core HTTP, middleware, wallet, NFT, Snap, Farcaster, Telegram, GitHub, Discord, push, party, WebSocket, and configuration behavior.
- [ ] `test_admin.py`: admin settings, users, sessions, audit, authorization, and HTML.
- [ ] `test_bankr_identity.py`: verified handle/address matching.
- [ ] `test_bots_computer_art.py`: SVG sanitization and animation.
- [ ] `test_collection_suggestions.py`: suggestions, validation, votes, credit spending, and over-voting prevention.
- [ ] `test_deposit_allocator.py`: ETH/ERC-20 forwarding and nonce serialization.
- [ ] `test_device_sync.py`: approval, restart, selection revisions, wallet ordering, expiry, and unsync.
- [ ] `test_economy.py`: arithmetic, sessions, deposits, ledger, idempotency, caps, routes, and disabled mode.
- [ ] `test_extra_companions.py`: discovery, caches, transfers, provider failures, and Nub reconstruction.
- [ ] `test_github_app.py`: JWT cryptography, installation discovery, token scope/cache/refresh, key replacement, and static-token compatibility.
- [ ] `test_hood_turtle_art.py`: sanitization and animation.
- [ ] `test_imported_gallery.py`: privacy, selection, collection/chain boundaries, deduplication, and pagination.
- [ ] `test_indexer.py`: log decoding, filters, checkpoints, idempotency, caps, and ETH/ERC-20 indexing.
- [ ] `test_nft_uri.py`: minted/unminted metadata and assets.
- [ ] `test_nub_art.py`: image validation and animation.
- [ ] `test_robot_care.py`: catalog, allowances, UTC reset, ownership, charging, prices, routes, and rewards.
- [ ] `test_robot_companion.py`: art parsing, ownership renewal, transfer revocation, discovery, and incomplete inventories.
- [ ] `test_robot_gallery.py`: concurrency, restarts, refreshes, mint/burn/reorgs, cache fallback, pagination, and headers.
- [ ] `test_telegram_interactive.py`: redaction, permissions, game loop, cards, GitHub progress, status, and triage.
- [ ] `test_telegram_media.py`: robot/turtle/PNG animation rendering.
- [ ] `test_telegram_moderation.py`: command grammar, filters, blocklist, strikes, and admin roles.
- [ ] `test_turtle_connect.py`: wallet-wide pairing, signatures, Bankr, multi-wallet discovery, RPC fallback, expiry, restart, ownership, unlinking, and origins.
- [ ] `test_wallet_migration.py`: legacy wallet-link migration and restart persistence.

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

## Safe implementation order

- [x] Phase 0: freeze inventories, parity harness, typed config, database compatibility probe, and deployment skeleton.
- [ ] Phase 1: pure utilities and parsers with no I/O.
- [ ] Phase 2: media generation and deterministic contract/crypto helpers using known vectors.
- [ ] Phase 3: repositories and schema compatibility against copied fixture databases.
- [ ] Phase 4: read-only routes such as health, metadata, galleries, and status endpoints.
- [ ] Phase 5: isolated signed webhooks and external integrations using captured fixtures and fake providers.
- [ ] Phase 6: authenticated mutation routes for profiles, pairing, device sync, care, voting, wallets, and economy.
- [ ] Phase 7: workers and restart recovery.
- [ ] Phase 8: Telegram orchestration and moderation.
- [ ] Phase 9: stateful WebSocket protocol and process-local presence.
- [ ] Phase 10: shadow comparison in staging with outbound side effects disabled.
- [ ] Phase 11: route canaries, then full cutover, with immediate rollback available.
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

- [ ] A production database backup has been created and a restore has been timed and verified.
- [ ] The TypeScript process can open a copied production database without schema mutation or data loss.
- [ ] There is only one writer for any stateful route during canary operation.
- [ ] Webhook providers point to only one side-effecting implementation.
- [ ] Shadow traffic strips credentials where possible and disables all external mutations.
- [ ] Health checks include database access and worker readiness without exposing secrets.
- [ ] Logs and metrics cover request failures, provider failures, WebSocket connections, worker lag, SQLite locks, webhook backlog, and challenge timers.
- [ ] The previous Python artifact, environment, service unit, and database backup are retained for rollback.
- [ ] Rollback requires no reverse database migration.
- [ ] Public health, web clients, native clients, Telegram, GitHub webhooks, Discord, WebSockets, RPC reads, and background indexers pass production smoke checks.
- [ ] Observe at least one complete timeout/cache/indexer cycle relevant to each migrated background behavior.
- [ ] Remove Python only after the agreed observation window and a separate explicit approval.

## Final retirement audit

- [ ] Inventory script reports zero uncovered Python routes, tables, environment keys, tests, background jobs, or WebSocket messages.
- [ ] No production process imports or executes `server/*.py`.
- [ ] No workflow, systemd unit, Docker file, Compose file, Caddy config, runbook, or deployment script starts Python.
- [ ] No client depends on an unported error shape or undocumented response field.
- [ ] Required GitHub checks run the TypeScript typecheck, targeted tests, parity manifest, build, and production startup smoke test.
- [ ] Python requirements and tests are archived or removed only in the retirement PR.
- [ ] Documentation describes the TypeScript source of truth and the supported local/deployment commands.
- [ ] Final production backup and rollback artifact locations are recorded privately.
