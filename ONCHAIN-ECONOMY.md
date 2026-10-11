# TinyFrens on-chain economy (design)

Status: **design only** — no mainnet deployment from this doc. Ship only after testnet + integration tests + verified proxy deploy.

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
| `contracts/TinyFrensNFT.sol` | On-chain companions (symbol `FREN`); separate from any **FRENS** utility token unless we explicitly link them. |

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

New tables (conceptual):

- `credit_accounts(pet_id, balance, updated_at)`
- `credit_ledger(id, pet_id, delta, reason, ref_type, ref_id, created_at)` — append-only
- `deposit_sessions(id, pet_id, address, expected_amount, status, tx_hash, expires_at, created_at)`

Rules:

- Grants only from **confirmed** deposits or **on-chain jackpot claim** events verified by contract logs.
- Idempotency: `(chain_id, tx_hash, log_index)` unique.
- Rate limits per `pet_id` and IP on `open` / `confirm` paths (same pattern as Bankr routes in `server/app.py`).

Credits stay **server-side** for v1 so gameplay stays fast and phone-friendly; optional future: merkle claims for large jackpots.

## Smart contracts (proxy-first)

Deploy on **Base** (align with NFT/Bankr stack) unless product says otherwise.

| Contract | Pattern | Purpose |
|----------|---------|---------|
| `FrensToken` (if not existing) | ERC-20, optional upgradeable mint role | Utility FRENS; mint policy frozen or governance later. |
| `Treasury` | UUPS proxy | Holds FRENS/ETH; only `GameController` can pull for jackpots/payouts. |
| `JackpotVault` | UUPS proxy | One or more pools; `fund()`, `drawWinner(bytes32 roundId, …)` with VRF or commit-reveal; emits `JackpotWon(petRef, amount)`. |
| `WorldFindRegistry` | UUPS proxy | Optional: on-chain record of “find” outcomes for transparency; gameplay RNG can stay off-chain with signed attestations from server oracle key. |
| `DepositRouter` (optional) | minimal proxy clones | One clone address per deposit session forwarding to treasury + emitting `Deposit(sessionId, from, amount)` for easy indexing. |

**Verification**: deploy implementation + proxy, verify both on Basescan, store addresses in server env (`FRENS_TOKEN`, `JACKPOT_PROXY`, `TREASURY_PROXY`, `CHAIN_ID`).

**Testing gate before mainnet**

1. Hardhat/Foundry unit tests: access control, reentrancy, upgrade auth, pause.
2. Testnet deploy with multisig or timelock as proxy admin.
3. Server integration tests against local fork or testnet (mock indexer).
4. Manual mobile pass: open deposit → pay from external wallet → credits appear without refresh hacks.

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
| `GET /api/economy/status` | Token addresses, chain, feature flags, open deposit slots. |
| `POST /api/deposits/open` | Requires `token`; returns session + address + exact amount. |
| `POST /api/deposits/refresh` | Optional client poll; server also indexes. |
| `GET /api/credits/balance` | Requires `token`. |
| `POST /api/credits/spend` | Internal; used by feed/objects when we gate features. |

Wallet tab UX: “Add credits” → pick package → show QR + copy + countdown → “Waiting for payment…” with auto-complete.

## Security notes

- Rotating addresses must be **generated or derived server-side**; never reuse an open session address for another user.
- Short TTL + cron to `expire` stale sessions and free slots.
- Monitor treasury; alert on unusual outflows.
- Separate **hot deposit keys** from **payout admin** (multisig).
- Do not store private keys in repo or Vercel; same bar as `BANKR_*` in `server/README.md`.

## Suggested branch split with collaborator

| Owner / branch | Scope |
|----------------|--------|
| Other dev / `main` or their feature | Landing, NFT permutations, shared releases |
| You / `feature/farcaster-miniapp-and-snaps` | Snap + Farcaster (current) |
| Either / `feature/onchain-economy` | `contracts/*`, deposit indexer, credit ledger, wallet UI |

Merge order: economy branch rebases on latest `main` after wallet identity is stable.
