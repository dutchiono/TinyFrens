# TinyFrens on-chain economy (design)

> **Historical v1 design:** New testnet deposit sessions now purchase account-scoped Energy, not
> device credits. Production deposits remain disabled. See
> [`docs/energy-economy-v2.md`](docs/energy-economy-v2.md) for the current behavior; legacy credit
> tables and direct treasury-transfer crediting are preserved without conversion.

Status: **contracts + server ledger implemented and tested locally; no mainnet deployment from this doc.** Ship only after testnet + verified proxy deploy.

## Git while others are on the repo

- **`main`** is what CI, Pages, and releases track. Avoid long-lived direct commits there when someone else is landing work.
- Keep **feature branches** (`feature/farcaster-miniapp-and-snaps`, `feature/8-frens-and-nft-permutations`, future `feature/onchain-economy`) and merge via PR when ready.
- Before starting on-chain server/API work: `git fetch origin` and rebase or merge `origin/main` into your branch so Bankr/wallet/snap changes stay compatible.
- On-chain work should live in **`contracts/` + server routes + web wallet UI`** on a dedicated branch so Farcaster/snap work does not block economy work.

## What we already have

| Piece | Role |
|--------|------|
| `pets` + device `token` (server) | Stable **off-chain identity** for a fren; every paid feature keys off `token` → `pet_id`. |
| `pet_wallets` + Bankr partner | **Per-fren EVM address** when `BANKR_PARTNER_KEY` is set; shared agent wallet otherwise. |
| `web/wallet.js` | Loads wallet with `{ token, pet }`; pattern for future “Buy credits” flows. |
| `contracts/TinyFrensNFT.sol` | On-chain companions (symbol `FREN`); separate from utility **FRENS**. |
| `contracts/config/economy.json` | Canonical addresses: production FRENS on Base, testnet profile for Sepolia. |

### Production FRENS (Base mainnet)

| Field | Value |
|--------|--------|
| `chainId` | `8453` |
| Contract | `0x1A96226727a1D0a46334b3A4b3878B32B7659ba3` |
| Symbol | FRENS (18 decimals) |

**Do not** point dev/test servers at this token until deposit + jackpot flows pass on **Base Sepolia** with `TestFRENS` (`contracts/testnet/`). The server refuses to enable economy features on `ECONOMY_MODE=production` until we flip that guard deliberately.

Jackpots and in-world finds are **game events**; credits can be **off-chain ledger** backed by on-chain deposits.

## Goals

1. **World jackpots** — funded pools (ETH and/or FRENS) that a fren can “find” via gameplay rules (RNG + caps + cooldowns), not raw wallet scraping.
2. **FRENS → credits** — user pays X FRENS; server grants spendable credits for cosmetics, objects, room perks, etc.
3. **Mobile-simple deposits** — user may pay from Coinbase Wallet / Warpcast / any external wallet; we must **attribute** the transfer to the logged-in fren without asking them to paste tx hashes.

## Recommended deposit attribution (mobile-first)

**Primary: deposit session + dedicated receive address (your rotating-wallet idea)**

1. Client (authenticated with device `token`) calls `POST /api/deposits/open`.
2. Server assigns **one** of N hot deposit addresses (or one **session sub-address** if we use a contract factory) exclusively to that `pet_id` for ~15 minutes.
3. Response: `{ depositId, address, token: FRENS, amountHint, expiresAt, qr }`.
4. User sends FRENS (exact amount or amount + small unique suffix — see below).
5. Indexer or polling worker sees transfer → `deposits` row `confirmed` → **credit ledger** updated → WebSocket/push to client “Credits added.”

Why this beats “paste tx hash”:

- One tap: copy address or deep-link to wallet with pre-filled transfer where the wallet supports it.
- No race: only one open session per address; second user gets the next free slot.
- Server is source of truth; chain is audit trail.

**Amount encoding (optional but helps auto-match)**

- Fixed SKUs: 100 / 500 / 1000 FRENS packages.
- Or **unique micro-tail**: requested amount = `base + (depositId mod 99)` in wei smallest units so two users paying “100 FRENS” at the same time still differ on-chain. UI shows the exact number prominently.

**Secondary (when user already has Bankr in-app)**

- If the fren wallet can **sign** via Bankr agent API: `transfer FRENS → treasury` in one shot; attribution is trivial (from = known `evm_address`). Keep deposit sessions for external wallets anyway.

**Do not rely on**

- Shared treasury + memo field (ERC-20 has no memo).
- Letting users send to the fren’s Bankr address for credits unless we clearly separate “NFT inbox wallet” vs “credit payment wallet” (confusing UX).

## Credit ledger (server)

Implemented in `server/economy.py` (tables created on app startup):

- `credit_accounts(pet_id, balance, updated_at)`
- `credit_ledger(id, pet_id, delta, balance, reason, ref_type, ref_id, created)` — append-only
- `deposit_sessions(id, pet_id, address, token, expected_amount, credits, status, chain_id, tx_hash, created, expires_at)`
- `deposits(id, session_id, pet_id, chain_id, tx_hash, log_index, amount, credits, created)` — unique `(chain_id, tx_hash, log_index)`

Rules:

- Grants only from **confirmed** deposits or **on-chain jackpot claim** events verified by contract logs.
- Idempotency: `(chain_id, tx_hash, log_index)` unique; replays are no-ops, and a session is **single-use**.
- `credits = wei * CREDITS_PER_FRENS / 1e18` (default 100 credits/FRENS); packages `10 / 50 / 100` FRENS.
- Rate limits per `pet_id` on `open` / `confirm` paths (same pattern as Bankr routes in `server/app.py`).
- Session TTL (default 900s); `open` expires any prior open session for the same pet.

Credits stay **server-side** for v1 so gameplay stays fast and phone-friendly; optional future: merkle claims for large jackpots.

## Smart contracts (proxy-first)

Deploy on **Base** (align with NFT/Bankr stack) unless product says otherwise.

| Contract | Pattern | Purpose |
|----------|---------|---------|
| FRENS (deployed) | ERC-20 on Base | `0x1A96226727a1D0a46334b3A4b3878B32B7659ba3` — no redeploy. |
| `TestFRENS` | testnet mintable ERC-20 | Base Sepolia only; see `contracts/testnet/README.md`. |
| `Treasury` | UUPS proxy ✅ implemented | `contracts/economy/Treasury.sol` — holds ETH/FRENS; `fundETH`/`fundERC20` open, `payETH`/`payERC20` controller-only, pausable, `Ownable2Step`. |
| `JackpotVault` | UUPS proxy ✅ implemented | `contracts/economy/JackpotVault.sol` — named pools (ETH or one ERC-20 each), open funding, controller-only `drawWinner`, emits `JackpotWon(poolId, winner, token, amount)`. |
| `WorldFindRegistry` | UUPS proxy | Optional: on-chain record of “find” outcomes for transparency; gameplay RNG can stay off-chain with signed attestations from server oracle key. |
| `DepositRouter` | UUPS proxy ✅ implemented | `contracts/economy/DepositRouter.sol` — session factory; `createSession`/`closeSession` (controller), deployable UUPS. |
| `DepositSession` | minimal-proxy clone ✅ implemented | `contracts/economy/DepositSession.sol` — one clone address per deposit session; auto-forwards ETH to treasury on `receive`, `sweep()` for ERC-20, emits `Deposit(sessionId, sender, token, amount)`. |

**Verification**: deploy implementation + proxy, verify both on Basescan, store addresses in server env (`FRENS_TOKEN`, `JACKPOT_PROXY`, `TREASURY_PROXY`, `CHAIN_ID`).

**Testing gate before mainnet**

1. Foundry unit tests (done): `forge test` runs `contracts/test/TestFRENS.t.sol`, `Treasury.t.sol`, `JackpotVault.t.sol`, `DepositRouter.t.sol` — access control, pausability, reentrancy-safe payouts, deposit forwarding/attribution, and upgrade authorization + state preservation (70 tests).
2. Server tests (done): `python -m unittest` in `server/` — includes `test_economy.py` (session/ledger unit tests + route tests + `create_app` wiring, 58 tests).
3. Testnet deploy via `contracts/testnet/script/DeployEconomy.s.sol` (now also deploys `DepositSession` impl + `DepositRouter` proxy) with multisig or timelock as proxy admin.
4. Live server integration against local fork or testnet (mock or real indexer).
5. Manual mobile pass: open deposit → pay from external wallet → credits appear without refresh hacks.

No production deploy without explicit owner approval.

## In-world jackpots (game layer)

Off-chain (server) for v1:

- Define **find tables**: biome, time, activity (walk, visit, room), probability, max wins per day.
- When a find triggers, if pool balance (from chain or cached treasury balance) allows payout:
  - Small payouts: increment credits from ledger (funded by prior deposits).
  - Large payouts: queue **on-chain claim** from `JackpotVault` to fren’s `evm_address` from `pet_wallets`.

On-chain v2:

- Server oracle (HSM key) calls `recordFind(petIdHash, roundId)`; contract enforces global emission cap.

Tie-break: use existing `pet_id` hash, not wallet address, so credits work before partner wallet exists.

## Web / API surface (future)

| Endpoint | Notes |
|----------|--------|
| `GET /api/economy/status` | Token addresses, chain, feature flags. |
| `POST /api/deposits/open` | ✅ Testnet only; requires `token` + `package` and a router-backed session; returns `{ depositId, address, token, chainId, amountWei, energyMilli, purchaseKind, expiresAt }`. |
| `POST /api/deposits/status` | ✅ Requires `token` + `depositId`; returns session status. |
| `POST /api/deposits/confirm` | ✅ Indexer callback; idempotent. Energy purchases require the configured `X-Indexer-Secret`; legacy confirmations retain the optional guard. 409 on reuse/expiry, 404 unknown. |
| `POST /api/credits/balance` | ✅ Requires `token`; returns `{ balance, history }`. |

`Economy.attach()` wires these in `create_app` (`server/app.py`). Two allocator modes:

- **Live on-chain (recommended)**: set `DEPOSIT_ROUTER_PROXY` + `GAME_CONTROLLER_PRIVATE_KEY` + `BASE_RPC_URL`; the server calls `DepositRouter.createSession` per open via `server/deposit_allocator.py` (`DepositRouterAllocator`, signed EIP-1559 tx, proven end-to-end against anvil in `server/test_deposit_allocator.py`).
- **Static pool (legacy credit only)**: `DEPOSIT_SESSION_ADDRESSES` is not accepted for new Energy purchases because it cannot bind a unique on-chain session id safely.

Deposit packages: 10 / 50 / 100 FRENS. The testnet Energy quote defaults to 1 Energy/FRENS and is
snapshotted when the session opens.

Wallet tab UX: "Add credits" → pick package → show QR + copy + countdown → "Waiting for payment…" with auto-complete.

## Security notes

- Rotating addresses must be **generated or derived server-side**; never reuse an open session address for another user.
- Short TTL + cron to `expire` stale sessions and free slots.
- Monitor treasury; alert on unusual outflows.
- Separate **hot deposit keys** from **payout admin** (multisig).
- Do not store private keys in repository or public frontend configuration; same bar as `BANKR_*` in `server/README.md`.

## Suggested branch split with collaborator

| Owner / branch | Scope |
|----------------|--------|
| Other dev / `main` or their feature | Landing, NFT permutations, shared releases |
| You / `feature/farcaster-miniapp-and-snaps` | Snap + Farcaster (current) |
| Either / `feature/onchain-economy` | `contracts/*`, deposit indexer, credit ledger, wallet UI |

Merge order: economy branch rebases on latest `main` after wallet identity is stable.
