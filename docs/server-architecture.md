# TinyFrens Server Architecture and TypeScript Migration Report

## Executive summary

TinyFrens now serves production traffic from the Node 22 TypeScript runtime in
`server-ts/`. The migration ran through 34 merged pull requests, from the
initial migration plan in PR #43 through the production cutover record in PR
#85. The implementation, staging shadow, canary, writable production-copy
audit, guarded cutover, public smoke tests, and rollback drill were completed
over roughly one day of continuous work.

At cutover:

- 416 TypeScript tests passed, along with typechecking and a production build.
- 17 production-safe HTTP requests matched the frozen Python reference in the
  isolated shadow environment.
- The copied production database retained all row counts and integrity; the
  only new permanent table was the expected `indexer_state` table.
- Public HTTP, CORS, static assets, Snap responses, WebSocket close behavior,
  and real GitHub webhook traffic succeeded on the TypeScript service.
- A live rollback drill started the retained Python service against the
  migrated database, passed health, then restored TypeScript successfully.
- Production now keeps Python stopped and disabled. Server-bound runtime and
  deployment helpers are Node/JavaScript/TypeScript only.

The migration was intentionally split into small PRs so schema, routes,
workers, integrations, media, WebSockets, deployment, and rollout safety could
be validated independently rather than landing as one unreviewable rewrite.

## Production topology

```text
Internet clients
  -> nginx TLS termination
  -> 127.0.0.1:8790
  -> Node 22 / Fastify (`server-ts/dist/main.js`)
  -> SQLite (`tinyfrens.db`, WAL mode)
  -> external providers through typed integration adapters

GitHub Actions website publish
  -> restricted SSH account
  -> Node receiver (`server/publish-web.mjs`)
  -> immutable static release + atomic `current` symlink
  -> HTTPS verification
  -> loopback deployment notification endpoint
  -> Telegram owner notification
```

Only one backend process owns writes to production SQLite. nginx does not split
stateful traffic between runtimes. Previous Python source is retained only as
local characterization material and is not a production entrypoint, service,
container, worker, or deployment receiver.

## Startup and request lifecycle

1. `server-ts/src/main.ts` loads typed configuration, opens SQLite, initializes
   the permanent schema, builds the application, starts enabled workers, and
   installs bounded signal handling.
2. `server-ts/src/context.ts` creates the dependency graph: repositories,
   domain services, provider adapters, rate limiter, clock, and random source.
3. `server-ts/src/app.ts` creates Fastify, installs raw-body and WebSocket
   support, registers error/origin middleware, serves browser assets, and
   mounts every route group.
4. Routes validate transport concerns and delegate stateful work to domain
   modules and repositories.
5. Repositories execute synchronous SQLite transactions. Provider calls stay
   behind integration interfaces so tests can use deterministic adapters.
6. `server-ts/src/lifecycle.ts` stops workers before closing Fastify and SQLite,
   with a bounded shutdown deadline for systemd and containers.

## Module map

### Composition and operations

| Module | Responsibility |
| --- | --- |
| `main.ts` | Process entrypoint, configuration, database, workers, listen, signals |
| `app.ts` | Fastify assembly, plugins, static files, routes, close hook |
| `config.ts` | Zod configuration schema and secret/public classification ledger |
| `context.ts` | Dependency graph and production adapter construction |
| `workers.ts` | Deposit indexer, treasury indexer, Telegram challenge restoration |
| `lifecycle.ts` | Idempotent, ordered, deadline-bounded shutdown |
| `rate-limit.ts` | Process-local bounded request/action rate limiting |
| `indexer-cli.ts` | Independent Node CLI for controlled indexer runs |

### HTTP and realtime routes

| Route modules | Surface |
| --- | --- |
| `health.ts` | Database-backed health response |
| `register.ts`, `account.ts`, `device-sync.ts` | Registration, profiles, linking, synchronized selections |
| `wallet-link.ts`, `turtle-connect.ts`, `wallet-nft.ts` | Signed ownership, discovery, mint/edit/unwrap |
| `economy.ts`, `collections.ts` | Deposit sessions, credits, balances, suggestions, voting |
| `robot-care.ts`, `galleries.ts`, `nft.ts` | Care, ownership, galleries, metadata and art |
| `bankr.ts`, `chat.ts`, `push.ts` | Bankr actions, Gemini chat, Web Push |
| `telegram.ts`, `discord.ts`, `github.ts`, `farcaster.ts` | Signed webhooks and platform integrations |
| `internal.ts` | Loopback-only, secret-authenticated deployment notifications |
| `admin.ts` | Private settings, users, audit, market, ledger, care diagnostics |
| `websocket.ts` | Auth, presence, friends, parties, visits, battles, limits, close codes |

### Database layer

| Module | Responsibility |
| --- | --- |
| `db/connection.ts` | `better-sqlite3`, WAL, busy timeout, read-only mode, transactions |
| `db/schema.ts` | Permanent table/index definitions and idempotent initialization |
| `db/migrations.ts` | Legacy wallet migration without retained scratch tables |
| `db/repositories/pets.ts` | Pets, friendships, requests, magic links, push subscriptions |
| `db/repositories/accounts.ts` | Profiles, identities, merges |
| `db/repositories/device-sync.ts` | Pairing codes, membership, optimistic revisions |
| `db/repositories/wallets.ts` | Managed wallets, external links, challenges, social profiles |
| `db/repositories/economy.ts` | Credit ledger, deposits, transfers, NFTs |
| `db/repositories/votes.ts` | Collection suggestions and vote totals |
| `db/repositories/robots.ts` | Care usage, ownership, discovery, gallery state |
| `db/repositories/telegram.ts` | Users, moderation, game, media cache, deploy subscriptions |
| `db/repositories/admin.ts` | Settings, users, sessions, audit records |

### Domain layer

- Identity and sync: `account.ts`, `profile.ts`, `codes.ts`,
  `device-selection.ts`, and `device-sync.ts`.
- Economy and chain state: `economy.ts`, `economy-math.ts`, `indexer.ts`,
  `vault-tx.ts`, `market-quote.ts`, and `market-quote-math.ts`.
- Ownership and care: `wallet-link.ts`, `turtle-ownership.ts`,
  `robots-verifier.ts`, `companion-verifier.ts`, `robot-care.ts`,
  `robot-care-rules.ts`, and `nft-traits.ts`.
- Telegram: `telegram-moderation.ts`, `telegram-grammar.ts`,
  `telegram-companion.ts`, and `deploy-notifications.ts`.
- Realtime and notifications: `realtime.ts` and `push.ts`.
- Administration: `admin.ts`.

Domain modules contain policy and state transitions. They do not bind ports or
read environment variables directly.

### Provider integrations

| Module | Boundary |
| --- | --- |
| `bankr.ts` | Bankr auth, wallet provisioning, monitor polling |
| `deposit-allocator.ts` | DepositRouter ABI calls, nonce serialization, receipts |
| `github-app.ts` | App JWT, installation discovery, token cache and refresh locking |
| `github.ts` | Issue drafting/creation, labels, webhook summaries |
| `telegram-api.ts` | JSON and multipart Telegram Bot API transport |
| `telegram.ts` | Telegram parsing, replies, cards, GitHub progress |
| `discord.ts` | OAuth exchange and Discord API constants |

Required provider failures are surfaced rather than silently replaced. Optional
notifications are explicitly classified as best-effort at their call sites.

### Crypto and media

- `crypto/signatures.ts` handles Ethereum personal-sign recovery, checksums,
  Telegram init-data HMAC, GitHub HMAC, and Discord Ed25519 verification.
- `crypto/vault.ts` derives deterministic Fren vault keys from known vectors.
- `media/*` validates and renders robot, turtle, Nub, Bots Computer, and
  Telegram GIF assets with bounded inputs and deterministic tests.

## Client contract

The browser app under `web/`, Android, iOS, desktop overlay, Farcaster Snap,
Telegram Mini App, and operational scripts share the same HTTP/WebSocket
contract. A source-derived CI test inventories route literals from every client
and fails if TypeScript does not register one.

Origin middleware preserves browser CORS while allowing explicitly enabled
native `Origin: null` clients. WebSocket authentication hashes the same device
token used by HTTP routes and enforces payload, connection, and action limits.

## Data and worker model

SQLite remains the system of record. Token quantities stay as decimal strings
or `bigint`; they are never passed through JavaScript floating-point numbers.
WAL mode and a five-second busy timeout preserve concurrency assumptions.

Workers start only when typed configuration is complete:

- Deposit indexing requires RPC, router, and controller configuration.
- Treasury indexing requires an explicit enable flag and treasury/token data.
- Telegram challenge restoration requires moderation and bot configuration.

Each indexer owns an independent `indexer_state` checkpoint, scans bounded
block ranges, and records idempotent chain events before advancing state.

## Deployment and rollback

`server/Dockerfile` compiles TypeScript in a build stage. The final image holds
Node, production dependencies, assets, and compiled JavaScript; Python is not
present in the runtime stage.

Static website releases are immutable. The restricted Node publisher rejects
unsafe archives and private/admin files, atomically swaps `current`, verifies
both public hostnames, and restores the prior release on failure. Backend
rollback uses the previous immutable TypeScript artifact and a verified SQLite
backup.

## Permanent runtime rule

TinyFrens production is JavaScript/TypeScript. Python may be used for local
reference tests or explicit operator-run maintenance, but it must not be added
to production traffic handling, workers, containers, systemd units, restricted
SSH commands, or deployment receivers. This rule is also recorded in the
repository `AGENTS.md`.
