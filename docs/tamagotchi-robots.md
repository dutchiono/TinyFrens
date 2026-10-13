# Tamagotchi Robots v1 — design plan

Status: **DESIGN — awaiting sign-off.** No implementation bundled with this doc.

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

## 7. Ownership gate

Reuse `server/robot_companion.py`: `Robots(db)`, `robots.discover(address)`, `ROBOTS_CONTRACT`
(`0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff`, Base 8453), `token_id()` (1–2664). The economy layer
authorizes on a fresh `ownerOf`, matching the existing companion flow.

## 8. Admin page

- Server route + web page, **token-protected**, non-public.
- Hosted at `tinyadmin.miono.live` via the existing Caddy pattern (`server/Caddyfile`,
  `server/README.md`); production runs as systemd `tinyfrens-server.service` on `miono`.
- Tunables: `usd_per_credit`, per-action credit costs, game reward amounts, Dev wallet address,
  feature flags, and a read of the credit ledger.

## 9. Phasing

- **P1 — Mechanics (no money). ✅ shipped in this branch.** `web/pet-engine.js` v4 adds the hearts
  view, weight, discipline/scold, care-mistake counter and the downed/revive lifecycle; Scold and
  Revive buttons were added to the shared web care screen (web + desktop) so a downed fren is never
  a dead end. Tests: `scripts/test-pet-engine.cjs`, wired into the quality gate. Non-robot shapes
  keep their existing behavior.
  - Not yet: the paid revive cost and the blocking paid top-up (P4), and the Scold/Revive affordance
    in the native Android/iOS overlays (P5) — those can still reach the web care screen via "More".
- **P2 — Server parity.** Small server mirror for money-affecting checks; `/api/robots/care`;
  parity tests with `pet-engine.js`.
- **P3 — Admin.** Route + page + token auth + `tinyadmin.miono.live`.
- **P4 — Money.** FRENS deposit to the fixed Dev wallet + `TreasuryTransferIndexer`, the daily free
  allowance + paid top-up enforcement, the paid revive cost, game earn-back, and the
  `CREDITS_PER_FRENS` reconciliation.
- **P5 — Polish.** Native overlay affordances, balance pass, telemetry, docs.

## 10. Decisions

Resolved:

1. **Authority model:** server-authoritative for **credits only**; care simulation stays in
   `pet-engine.js`. ✅
2. **Lifecycle:** no permadeath — a neglected robot is downed/runaway and revives for **~10¢**. ✅
3. **Deposit rollout:** **mainnet only** (FRENS is live on Base); no testnet. Indexer rehearsed
   read-only, live deposits gated by `economy_settings()`, small cap first. ✅

Still open:

4. **Dev wallet address(es)** for mainnet FRENS deposits.
5. **Exact FRENS prices** for food / energy / actions / revive, and the daily free allowance. Can be
   set later in the admin page; only the *shape* is needed to build P2–P4.

## 11. Non-goals

- No ownership gate, NFT-player rig, or games-hub rebuild — those ship already.
- No change to non-robot shapes, collections, or visitor behavior.
- No on-chain care state and no NFT attributes minted by play.
