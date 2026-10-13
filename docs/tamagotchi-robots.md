# Tamagotchi Robots v1 — design plan

Status: **Building in phases.** P1 (mechanics), P2 (server care layer), P3 (admin), P4 (money —
server core) and P4b (client wiring) ship in stacked branches; P5 follows. Live mainnet deposits are
**not yet enabled** (§6.2, §9).

Baseline: `origin/main` @ `2e2e8d3` (this worktree, branch `feat/tamagotchi-robots-economy`).
The previous draft of this doc was written against a stale branch and treated games/ownership/
economy as new. This version is corrected against the code that actually ships.

## 1. Goal

Turn **TinyFrens: Robots v1** NFTs into a Tamagotchi-style virtual pet:

- Only Robots v1 (`tinyfrens-robots-v1`, `0xd745…` on Base 8453, tokens 1–2664) get the gamified
  layer. Every other shape/NFT stays a friend/visitor.
- As close to the original Tamagotchi (P1/P2, 1996–97) as practical, on top of the care engine
  that already exists.
- A very cheap FRENS economy: users deposit FRENS → in-game **credits**; FRENS go to the Dev
  wallet; credits land ~1:1-ish on the account.
- An admin page (non-public, at `tinyadmin.miono.live`) to tune the variables.

## 2. What already exists (the honest audit)

Everything below ships on `origin/main` today and is the foundation — not something to rebuild.

| System | Where | Notes |
|---|---|---|
| Care engine (the single source of rules) | `web/pet-engine.js`, used by every platform | hunger/food, happiness/joy, energy, poops, sick, bored, lost, day-based stages, modes |
| Care actions | `GAMEPLAY.md`, `web/app.js` | Feed +25, Play +20 (food −8, energy −12), Nap +25, Clean, Vitamin |
| Mini-games hub | `web/games.js`, `#screen-games`, `web/index.html` | `More → Games` → picker |
| Snack Catch | `web/game-snack-catch.js`, `scripts/test-snack-catch.cjs` | first game; pure round model + browser mount |
| Game → care bridge | `window.TinyFrensGameCare` in `web/app.js` (`canPlay()`/`complete()` → existing Play action) | a 15s+ round with a positive score invokes Play once |
| Verified NFT players | `web/game-players.js` (`tinyfrens-robots-v1`, `hood-turtles-v1`, `nubs-v1`, `bots-computers-v1`) | ownership-checked, animation rigs, 5-min inventory cache; `scripts/test-game-players.cjs` |
| Robots v1 ownership + rig | `server/robot_companion.py` (`Robots`, `CONTRACT`, `CHAIN_ID=8453`, tokens 1–2664), `server/robot_gallery.py` | `/api/featured/companion`, on-chain `ownerOf`, 8-step walk frames |
| Collection identity rules | `contracts/config/COLLECTIONS.md` | editorial id `tinyfrens-robots-v1`, symbol `TFROB1` |
| Credit ledger + deposits | `server/economy.py`, `contracts/config/economy.json` | `deposit_sessions`, `deposits`, `credit_accounts`, `credit_ledger`; `CREDITS_PER_FRENS=100`; `spend()` already used by `save_nft_changes` |
| Deposit indexing | `server/indexer.py` (`DepositIndexer`) | model for a treasury-transfer indexer |
| Cross-device sync | `server/device_sync.py`, `web/device-sync.js` | wallet links + companion choices |
| Production gating | `economy_settings()` in `server/app.py` | production stays off until explicitly enabled |

**The seam to open:** `GAMEPLAY.md` states games affect care but **"do not create NFT attributes
or token rewards."** That boundary is exactly what this feature crosses — for robots only.

## 3. The actual gap (what is missing)

1. Tamagotchi-faithful mechanics not yet in `pet-engine.js`: **weight, discipline/scold,
   care-mistake counter, a real lifecycle consequence**, and a hearts view.
2. Games reward care but **nothing earns or spends credits** from play.
3. `CREDITS_PER_FRENS` is a fixed `100`, unrelated to USD — not the "few cents" pricing wanted.
4. Deposits use rotating `DepositSession` clones via `DepositRouter`; the plan wants a **single
   fixed Dev wallet** for v1.
5. No admin surface to tune any of it.

## 4. Design principles

- **Reuse, don't rebuild:** the care engine, the Robots verifier, the credit ledger, and the games
  hub are the substrate. Additive changes only.
- **Robots-only:** gate the gamified layer by `tinyfrens-robots-v1` ownership; other shapes and
  collections are untouched.
- **Server-authoritative only where money moves.** Credit earning/spending is decided server-side.
  Care simulation stays in `pet-engine.js` as it is today, so offline, floating-overlay, desktop and
  native behavior are unchanged.
- **No silent fallbacks for chain calls.** Ownership and deposit checks fail closed, as the repo
  already does (`server/robot_companion.py`, `ONCHAIN-ECONOMY.md`).

## 5. Mechanics (Tamagotchi-faithful, additive)

Added to `web/pet-engine.js` (plain ES5, additive so other shapes are unaffected), mirrored in a
small server module only for the parts that touch money (P2):

- **Daily free allowance** — a per-day budget of care actions/energy (enforced in P4). This is the
  free loop: a patient player can keep a robot alive without paying. Paid FRENS top-ups extend it
  (see §6).
- **Hearts view** — cosmetic: each 25 points of a 0–100 stat = one heart (4 hearts).
- **Weight** — feed adds, play/adventure subtracts; over/under-weight raises sickness odds.
- **Discipline / scold** — a misbehave window → scold action → a discipline meter; scolding a
  well-behaved fren lowers it (as in the original).
- **Care-mistake counter** — care needs left unmet past the window increment mistakes; mistakes
  count toward the downed state (evolution quality hooks come later).
- **Lifecycle consequence — no permadeath.** A neglected robot is **downed / runs away**: care is
  blocked until the **Revive** action. P1 revive is free; the **~10¢ revive cost** lands in P4.
  There is no permanent death — a deliberate deviation from the original.

## 6. Economy (plain terms)

The pet has a **free daily loop** and a **paid top-up loop**, paid in **FRENS** the user deposits.

- **Free daily loop (like the original).** The pet gets a daily allowance of care actions / energy.
  Energy also regenerates via Nap and over time (already in `pet-engine.js`). A patient player can
  keep a robot alive indefinitely without paying.
- **Paid top-up.** When the daily allowance runs out and the player wants more actions that day, they
  spend deposited **FRENS** for extra food / energy / actions. Prices are set in FRENS and are
  admin-tunable (e.g. "a piece of food = 1,000 FRENS"; exact numbers TBD).
- **Games (both at once):** a finished round grants a little care (food/joy/energy) **and** earns a
  small amount back toward the FRENS balance — the same care path Snack Catch uses today, plus a
  small money-back. Amounts admin-tunable; scope = Snack Catch for v1.
- **Revive.** A neglected robot is downed/runaway (no permadeath) and revives for FRENS (~10¢ worth,
  admin-tunable).
- **Deposit (v1).** User sends FRENS **directly to a fixed Dev wallet**; a new
  `TreasuryTransferIndexer` (modeled on `server/indexer.py`) watches ERC-20 `Transfer` logs to that
  address and credits the balance idempotently on `(chain_id, tx_hash, log_index)`. A later upgrade
  can swap in a proxy contract without changing the client.

**Display and the internal counter.** `server/economy.py` currently stores the balance in an internal
integer it calls "credits" (`CREDITS_PER_FRENS=100`), and `spend()` is already used by
`save_nft_changes`. Everything user-facing will be shown **in FRENS**; the internal counter is an
implementation detail. `CREDITS_PER_FRENS` becomes configurable/tunable (not hardcoded 100) and is
reconciled with the existing `save_nft_changes` spend in P4.

**Pricing note.** Because prices are set in FRENS, the real-world (USD) cost of an action drifts with
the FRENS market. Accepted for v1. If a stable cent cost is wanted later, convert via the existing
price oracle at spend time.

⚠️ **Mainnet-only risk (your call, flagged for the record):** FRENS is live on Base mainnet, so
deposits point at mainnet with no testnet rehearsal. Mitigations before enabling live deposits:
rehearse the `TreasuryTransferIndexer` against mainnet logs **read-only**, gate live deposits behind
the existing `economy_settings()` flag, and start with a small cap. Fail closed on any RPC error.

## 6.1 Server care layer (P2)

`server/robot_care.py` owns only what touches money:

- the catalogue of care actions (`feed, play, rest, adventure, clean, vitamin, scold, revive`)
  and the flavour actions that are always free (`pet`),
- the FRENS price of one use once the free daily allowance is spent,
- the per-pet, per-UTC-day free allowance ledger (`robot_care_daily`).

Endpoints (robots-only, gated by a fresh `ownerOf` against the pet's linked wallets, like the
companion flow):

- `POST /api/robots/care` `{token, tokenId}` → `{tokenId, allowance, prices, actions, freeActions, creditsPerFrens, balance}`
- `POST /api/robots/care/action` `{token, tokenId, action}` → `{allowed, free, charged, allowance}`;
  within the allowance it is free, beyond it the FRENS price is **charged from the credit ledger**
  (P4). When the balance is short it returns
  `{allowed: false, requiresPayment: true, priceFrens, balance, shortfall}` and moves nothing.
- `POST /api/robots/game` `{token, tokenId, game}` → the small game earn-back (P4): grants the
  admin-tunable `gameRewardCredits` (0 = off) and returns `{granted, balance}`.

Ownership uses `Robots.owner_of()` (a fresh `ownerOf` with no cache and no metadata), not the 24h
`read()` cache — charging and crediting must see current ownership.

Tunables are env-overridable (`ROBOT_CARE_DAILY_ALLOWANCE`, `ROBOT_CARE_PRICE_<ACTION>`,
`ROBOT_CARE_GAME_REWARD_CREDITS`) and are edited live on the admin page (P3). The care *simulation*
stays in `web/pet-engine.js`; nothing here changes offline, floating-overlay, desktop or native
behavior.

## 6.2 Money layer (P4)

The deposit path is the v1 **direct transfer**: a player sends FRENS straight to the fixed Dev
wallet, and `TreasuryTransferIndexer` (`server/indexer.py`) watches ERC-20 `Transfer` logs to that
address.

- **Destination is env-only and fail-closed.** The target address comes from `FRENS_TREASURY` with
  **no default**, and the indexer only starts when `FRENS_TREASURY_INDEXER=true`. It is deliberately
  **not** admin-tunable: an admin-token compromise must not be able to redirect deposits. Every
  transfer is capped (`FRENS_TREASURY_MAX_CREDITS`) and the scan fails closed on any RPC error.
- **Attribution.** Because there is no per-session address, each `Transfer` is matched to the pet
  whose linked wallets include the sender (`resolve_wallet_pet`). If the sender maps to **zero or
  several** pets, the transfer is recorded in `treasury_transfers` with status `unmatched` and credits
  **nothing** for manual reconciliation — we never guess. Over-cap (`over_cap`) and sub-credit
  (`dust`) transfers are recorded the same way. Crediting is idempotent on
  `(chain_id, tx_hash, log_index)`.
- **Counter.** `Economy.credits_per_frens` is now configurable (default 100) instead of a hardcoded
  constant; `treasury_transfers` is the on-chain provenance of every credited deposit.
- **Charging.** `server/robot_care.py` charges the paid top-up (and the paid revive) from the credit
  ledger on the paid branch; the ledger's `spend()`/`grant()` are the only money movements.

## 7. Ownership gate

Reuse `server/robot_companion.py`: `Robots(db)`, `robots.discover(address)`, `ROBOTS_CONTRACT`
(`0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff`, Base 8453), `token_id()` (1–2664). The economy layer
authorizes on a fresh `ownerOf`, matching the existing companion flow.

## 8. Admin page

Shipped (P3):

- `server/admin.py` — token-protected (`Authorization: Bearer $ADMIN_TOKEN`) routes under
  `/api/admin/*`. With no `ADMIN_TOKEN` the whole surface answers **503**, so nothing is exposed by
  accident; the token is compared in constant time. This surface never touches keys, seeds or
  deployments.
- `GET /api/admin/state` — care tunables (effective + overrides), the care-action list, economy
  status (including the read-only deposit treasury address, the per-transfer cap and
  `creditsPerFrens`), counts and the recent audit log. `POST /api/admin/settings` — retune
  `dailyAllowance`, `gameRewardCredits` and the per-action FRENS prices; persisted in `app_settings`
  and read **live** by the care layer (so `RobotCare` re-reads them per request, no restart).
  `GET /api/admin/ledger` and `GET /api/admin/care` — read-only views of the credit ledger and daily
  care usage.
- `web/admin.html` (reached via `/admin`) — the operator page. The API is origin-independent (it
  carries its own bearer token) and every response is `Cache-Control: no-store`.
- Deployment: reachable at `/admin` on `PET_DOMAIN`, or on its own host by setting `ADMIN_DOMAIN`
  and uncommenting the Caddy block (`server/Caddyfile`, `server/README.md`); production runs as
  systemd `tinyfrens-server.service` on `miono`.

The **deposit treasury address is deliberately not admin-tunable** — it is env-only and fail-closed
(P4, §6.2). The admin page shows it read-only. `usd_per_credit` is dropped — prices are denominated
in FRENS.

## 9. Phasing

- **P1 — Mechanics (no money). ✅ shipped in this branch.** `web/pet-engine.js` v4 adds the hearts
  view, weight, discipline/scold, care-mistake counter and the downed/revive lifecycle; Scold and
  Revive buttons were added to the shared web care screen (web + desktop) so a downed fren is never
  a dead end. Tests: `scripts/test-pet-engine.cjs`, wired into the quality gate. Non-robot shapes
  keep their existing behavior.
  - Not yet: the paid revive cost and the blocking paid top-up (P4), and the Scold/Revive affordance
    in the native Android/iOS overlays (P5) — those can still reach the web care screen via "More".
- **P2 — Server parity. ✅ shipped in this branch.** `server/robot_care.py` is the small server
  mirror for the money-affecting checks only: the care-action catalogue, the per-action FRENS price,
  and the free daily allowance. `POST /api/robots/care` (status/quotes) and
  `POST /api/robots/care/action` (record one use) are robots-only, authorized on a fresh `ownerOf`
  against the pet's linked wallets (see §6.1). **It never moves FRENS** — the paid branch reports
  `requiresPayment`/`priceFrens` for P4 to charge. Tests: `server/test_robot_care.py`, including a
  parity test that every catalogued action still exists in `web/pet-engine.js`.
- **P3 — Admin. ✅ shipped in this branch.** Token-protected `/api/admin/*` plus the operator page
  at `web/admin.html` (§8). Care tunables move to `app_settings` and are read live, so
  `server/robot_care.py` re-resolves its allowance/prices per request. Tests:
  `server/test_admin.py`.
- **P4 — Money.** Server money core **✅ shipped in this branch**; client wiring follows as P4b.
  - `TreasuryTransferIndexer` (`server/indexer.py`): ERC-20 `Transfer` → fixed Dev wallet, matched to
    the pet by sender, idempotent, fail-closed (§6.2). `Economy.credit_transfer` +
    `treasury_transfers` ledger and a configurable `credits_per_frens`.
  - Paid top-up and paid revive **charged** from the credit ledger in `server/robot_care.py`;
    game earn-back via `POST /api/robots/game` and the admin-tunable `gameRewardCredits`.
  - Fresh `ownerOf` (`Robots.owner_of`) for the money paths; admin shows the read-only treasury and
    rate. Deployment knobs: `FRENS_TREASURY`, `FRENS_TREASURY_INDEXER`, `FRENS_TREASURY_MAX_CREDITS`,
    `FRENS_TREASURY_CHAIN_ID`, `FRENS_TREASURY_TOKEN`.
  - Tests: `server/test_economy.py` (transfers), `server/test_indexer.py` (decode + scan),
    `server/test_robot_care.py` (charging + game), `server/test_admin.py`, `server/test_app.py`.
  - **P4b — client wiring. ✅ shipped in this branch.** `web/robot-care.js`
    (`window.TinyFrensRobotCare`) is the web client for the P4 server contract: it finds the active
    Robots v1 from the verified `tinyfrens-companions` store, shows the FRENS balance and today's free
    allowance on the Care screen, reports each care action to `/api/robots/care/action`, and collects
    the game earn-back from `/api/robots/game` on the `tinyfrens-game-finished` event (`web/app.js`
    calls `after()` from the shared care loop; `web/index.html` loads the module). It is **additive and
    non-blocking**: offline, unknown-identity and no-robot cases fall through so the care simulation —
    and native/desktop/overlay play — behave exactly as before. Tests: `scripts/test-robot-care.cjs`
    (resolution, FRENS formatting, paid prompts, endpoint wiring, offline safety), wired into
    `quality-gate.yml`.
  - **Not yet (P4c):** hard-blocking a care action on payment (with the top-up/deposit screen and the
    deposit address shown to the owner), a multi-robot picker UI (`TinyFrensRobotCare.setActive`
    already backs one), and the native Android/iOS overlay affordances (P5). On-chain live deposits
    are **not yet enabled** and must be rehearsed read-only against Base mainnet first (§6, ⚠️).
- **P5 — Polish.** Native overlay affordances, balance pass, telemetry, docs.

## 10. Decisions

Resolved:

1. **Authority model:** server-authoritative for **credits only**; care simulation stays in
   `pet-engine.js`. ✅
2. **Lifecycle:** no permadeath — a neglected robot is downed/runaway and revives for **~10¢**. ✅
3. **Deposit rollout:** **mainnet only** (FRENS is live on Base); no testnet. Indexer rehearsed
   read-only, live deposits gated by `economy_settings()`, small cap first. ✅

Still open (deploy-time values, not code):

4. **Dev wallet address(es)** for mainnet FRENS deposits — set `FRENS_TREASURY` (env-only, fail-closed;
   no default). The code ships without it, so the path is inert until an operator sets it **and**
   `FRENS_TREASURY_INDEXER=true`.
5. **Exact FRENS prices** for food / energy / actions / revive, and the daily free allowance — set on
   the admin page (`dailyAllowance`, `prices`, `gameRewardCredits`); only the *shape* was needed to
   build P2–P4.
6. **`CREDITS_PER_FRENS` re-anchor** — now configurable (`Economy.credits_per_frens`, default 100).
   The existing `save_nft_changes` spend still assumes 100; changing the rate is a deploy decision
   that must not silently reprice saved looks.

## 11. Non-goals

- No ownership gate, NFT-player rig, or games-hub rebuild — those ship already.
- No change to non-robot shapes, collections, or visitor behavior.
- No on-chain care state and no NFT attributes minted by play.

## Integration follow-up

The shared Care screen now asks the server before changing a robot's local care state.
Insufficient FRENS or an offline/unconfirmed request blocks that action; other NFT
collections retain their existing care loop. Paid care asks for confirmation first.
The screen includes a multi-robot picker and authenticated deposit guidance. Deposit
addresses are exposed only when the env-configured indexer and economy are enabled;
otherwise the UI states deposits are closed. Live deposits remain disabled pending
operator treasury/pricing inputs and a read-only mainnet rehearsal.
Android NFT overlay menus include a Care shortcut; desktop companion double-click
opens Care. iOS uses its existing tinyfrens://care route and shared Care screen.
No iOS overlay over other apps is claimed.
