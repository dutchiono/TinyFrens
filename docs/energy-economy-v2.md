# Account Energy economy (v2 working design)

Status: account Energy, Robot-care integration, and testnet instant-Energy deposits are implemented.
Production deposits, staking, holding/burn boosts, and fee routing remain inactive.

## Vocabulary and ownership boundary

- **Energy** is an off-chain, account-scoped spend balance used for game actions. It is never
  redeemable for FRENS.
- **Stamina** is the per-companion survival stat currently stored as `energy` by the Telegram game.
  The stored field can be migrated separately; API and UI copy should call it Stamina.
- An account must currently own at least one Robots v1 NFT to recharge or play.
- Energy, holding boosts, staking, and burn boosts belong to the player account. None is assigned to
  an individual Robot. An action may target any companion the account currently owns.

The legacy `credit_accounts`, `credit_ledger`, and `robot_care_daily` tables remain unchanged during
the foundation phase. They are keyed by device/pet ID and must not be treated as the new account
ledger.

## Starting recharge math

For `N` currently eligible Robots:

```text
N = 0: recharge = 0 and gameplay is locked
N > 0: recharge/day = 18 + 6N Energy
rechargeable capacity = 3 * recharge/day
```

Energy is stored as integer milli-Energy so six-hour accrual and future fractional rates do not lose
precision. Purchased Energy is a separate bucket and is not subject to the rechargeable capacity.
Spending uses rechargeable Energy first.

| Robots | Energy/day | Energy/6h | Rechargeable capacity |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | existing balance retained |
| 1 | 24 | 6 | 72 |
| 2 | 30 | 7.5 | 90 |
| 5 | 48 | 12 | 144 |
| 10 | 78 | 19.5 | 234 |
| 50 | 318 | 79.5 | 954 |

At an action cost of 4–7 Energy, one Robot supports roughly one action-heavy session every six
hours. The capacity scales with the rate, so larger holders can bank more play without an unrelated
fixed hard cap.

The initial configurable action costs are feed 4, play/mini-game 5, rest 4, adventure 7, clean 4,
vitamin 6, scold 4, and revive 7 Energy. The rate, capacity, policy version, and individual costs are
environment settings so testnet tuning does not require a schema change. Starting a mini-game pays
the Play cost before the round begins.

Rate and capacity settings are versioned inputs. Before a policy or entitlement changes, accrued
Energy is settled at the old stored rate. A reduced capacity never deletes already-earned Energy;
it only stops recharge until the balance falls below the new capacity. Ownership event processing
must eventually settle accounts close to the transfer time so a wallet cannot accrue indefinitely at
a stale Robot count.

## FRENS holding, staking, and burning

These inputs remain inactive in gameplay. The draft simulator lives in
`server-ts/src/domain/energy-economy-simulator.ts`; its editable inputs and example accounts are in
`docs/energy-economy-scenarios.json`. Run it from `server-ts/` with:

```text
npm run simulate:energy
```

The starting candidate uses a capped logarithmic curve rather than raw linear token ownership:

```text
component boost bps = min(component cap, bps-per-doubling * log2(1 + FRENS / 1,000))
daily Energy = (18 + 6 * Robots) * (1 + sum(component boost bps) / 10,000)
capacity = capacity days * daily Energy
```

| Component | Boost per doubling | Component cap | Maximum multiplier contribution |
| --- | ---: | ---: | ---: |
| Liquid holding | 5% | 75% | +0.75x |
| Staked | 10% | 150% | +1.50x |
| Permanently burned | 15% | 225% | +2.25x |

At all three caps the total multiplier is 5.5x. The capacity remains three days of the boosted
rate, so it expands with account entitlement instead of imposing an unrelated fixed ceiling.
Staked FRENS is not counted as liquid FRENS. With zero eligible Robots every token boost is zero and
gameplay remains locked.

The draft examples produce:

| Scenario | Robots | Liquid / staked / burned FRENS | Energy/day | Energy/6h | Avg-cost actions/6h |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starter | 1 | 0 / 0 / 0 | 24.00 | 6.00 | 1.1 |
| Collector | 5 | 50k / 0 / 0 | 61.61 | 15.40 | 2.8 |
| Staker | 5 | 10k / 100k / 0 | 88.26 | 22.07 | 4.0 |
| Burner | 5 | 10k / 100k / 25k | 122.11 | 30.53 | 5.6 |
| Whale | 25 | 1m / 1m / 500k | 645.18 | 161.30 | 29.3 |
| Super whale | 50 | 10m / 3m / 5m | 1,482.74 | 370.69 | 67.4 |

These are tuning candidates, not approved production coefficients. A permanent burn bonus is
irreversible, and actual holder/staker distribution data may show that the proposed curve or caps
are still too generous.

The eventual rate has separate, auditable components:

```text
total recharge rate = robot base + liquid-holding boost + staking boost + permanent burn boost
```

Requirements before choosing coefficients:

1. Snapshot the FRENS holder distribution and model at least median, 90th, 99th percentile, and
   largest non-project wallets.
2. Exclude treasury, liquidity, splitter, rewards, and other project-controlled addresses.
3. Do not double-count staked FRENS as liquid holdings.
4. Use diminishing returns or explicit component caps; publish examples before enabling a burn.
5. Settle the old rate before every indexed holding, stake, unstake, or burn entitlement change.
6. Keep rare in-game FRENS discoveries separate from ordinary Energy rewards and cap their total
   emission budget.
7. Run the simulator against a real holder snapshot and record median, p90, p99, and largest
   non-project account session capacity before activating any boost.

## FRENS purchases

New deposit sessions on testnet are **instant Energy** purchases, not an exchange balance and not a
path back to FRENS. The initial quote is configurable with
`TESTNET_ENERGY_MILLI_PER_FRENS` and defaults to 1,000 milli-Energy (1 Energy) per FRENS. The quote
is copied into the session when it opens, so later configuration changes cannot reprice a pending
purchase.

Confirmation records the chain event and grants purchased Energy to the device's current account in
one database transaction. The `(chain_id, tx_hash, log_index)` identity makes fulfillment
idempotent. Account resolution happens at confirmation, so a safely recovered or merged account
receives the purchase. If fulfillment fails, both the deposit record and session confirmation roll
back. The confirmation chain must match the session chain. HTTP confirmation of an Energy purchase
also requires `ECONOMY_INDEXER_SECRET`; without it, only the internal chain indexer can confirm the
session. Opening an Energy purchase requires a router-backed session id; the reused address-pool
fallback remains legacy-credit-only. The indexer requires that id and deposit token to match the
open session, preventing a delayed event for a reused address from crediting a newer buyer.
Purchased Energy is uncapped and separate from rechargeable Energy.

Historical deposit sessions and balances remain `legacy_credit`; the migration labels them without
converting or duplicating value. Direct treasury-transfer crediting also remains legacy behavior.
Production deposit opening is disabled even if its feature flag is set. Admin state and
`/api/admin/energy` expose the quote, totals, ledger entries, and confirmed testnet purchases.

## Staking rewards and creator fees

Staking has two different benefits:

- a larger off-chain Energy recharge boost; and
- a pro-rata share of the staker half of actual FRENS creator fees.

The proposed on-chain flow is:

```text
Bankr/Doppler creator-fee claim
  -> FeeSplitter
       -> 50% project Safe treasury
       -> 50% FRENS staking-rewards contract
```

The project treasury, splitter, and staking-rewards contract must be distinct addresses. The
splitter distributes only newly held FRENS and finishes with a zero FRENS balance. Treasury funds
must never automatically return to the splitter, preventing the project half from entering the next
split. Destination changes should be two-step and timelocked, and both destinations must be settled
before a change.

The rewards contract should use a cumulative reward-per-staked-token accumulator so fees are
distributed without looping over stakers. Behavior when there are zero stakers must be explicit;
the safe default is to retain the staker half as pending rewards, not redirect it into treasury.
No production fee recipient changes or contract deployments are part of this foundation.

The simulator also models this 50/50 fee split. For example, 100,000 FRENS of weekly fees and
5,000,000 total FRENS staked produces a 50,000 FRENS weekly staker pool. A 100,000 FRENS position
owns 2% of the pool and receives 1,000 FRENS/week. The displayed annual percentage is a simple
projection, not a promised yield; it changes directly with actual fees and total stake.

## Account wallets and recovery

The target identity model is `account -> devices + verified identities + verified wallets`. Wallet
links must become account-scoped and unique by `(chain_id, address)` rather than copied to every
synced device.

During migration, the account wallet is authoritative while the legacy device table is dual-written
only for old deposit/indexer compatibility. Duplicate legacy claims from unrelated accounts are not
silently shared: the earliest unambiguous account is retained and an unresolved conflict is exposed
in admin counts until a fresh wallet proof joins the accounts.

When two device accounts merge, purchased Energy is summed because it represents paid value, while
rechargeable Energy uses the larger balance rather than the sum. This prevents farming multiple free
account balances and then combining them. Both accounts must be settled before the merge is allowed.

Bankr-first recovery should use a short-lived, single-use challenge signed by the user's Bankr
wallet. TinyFrens verifies the recovered signer, finds the unique account wallet, issues a new device
credential, and offers revocation of old devices. TinyFrens must not request or store a user's Bankr
API key. Public social-profile resolution is useful corroboration but is not sufficient recovery
proof.

The existing Bankr connect-code flow can perform this recovery safely: the waiting device creates a
short-lived pairing, Bankr returns a `personal_sign` signature, and the user explicitly accepts on
the waiting device. If that signer is already an active account wallet, the new device joins that
existing account instead of creating a duplicate wallet owner. Legacy bearer restore links are
single-use, replace older links, and expire after 15 minutes; wallet-signature recovery is preferred.

## Delivery order

1. Account Energy schema and deterministic math. **Implemented.**
2. Account-scoped verified wallets and safe merge/recovery semantics. **Implemented.**
3. Ownership inventory that settles rate changes and fails closed when chain verification fails.
   **Implemented at authenticated care/game access; transfer-event settlement is still required.**
4. Adapt robot care/actions to account Energy and rename the companion stat to Stamina.
   **Implemented for the shared web care UI and API.**
5. Convert testnet purchases to instant Energy while preserving historical credits. **Implemented.**
6. Simulate and approve holding/staking/burn coefficients. **Draft simulator implemented;
   coefficients still require real distribution data and approval.**
7. Audit, verify, and test contracts on Base Sepolia before any production fee routing.
