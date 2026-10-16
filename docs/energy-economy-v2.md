# Account Energy economy (v2 working design)

Status: foundation only. This document records the agreed direction and the boundaries that must be
resolved before live credits, deposits, staking, or fee routing are migrated.

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

Rate and capacity settings are versioned inputs. Before a policy or entitlement changes, accrued
Energy is settled at the old stored rate. A reduced capacity never deletes already-earned Energy;
it only stops recharge until the balance falls below the new capacity. Ownership event processing
must eventually settle accounts close to the transfer time so a wallet cannot accrue indefinitely at
a stale Robot count.

## FRENS holding, staking, and burning

These inputs are intentionally not active in the first implementation. A raw linear token formula
would make token whales effectively unlimited and a permanent burn bonus is irreversible, so both
need real distribution data and simulations first.

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

## FRENS purchases

The existing deposit purchase becomes an **instant Energy** purchase, not an exchange balance and
not a path back to FRENS. A migration must be explicit and idempotent. Existing credit balances must
not be silently converted until the conversion rule and customer communication are approved.

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

## Account wallets and recovery

The target identity model is `account -> devices + verified identities + verified wallets`. Wallet
links must become account-scoped and unique by `(chain_id, address)` rather than copied to every
synced device.

When two device accounts merge, purchased Energy is summed because it represents paid value, while
rechargeable Energy uses the larger balance rather than the sum. This prevents farming multiple free
account balances and then combining them. Both accounts must be settled before the merge is allowed.

Bankr-first recovery should use a short-lived, single-use challenge signed by the user's Bankr
wallet. TinyFrens verifies the recovered signer, finds the unique account wallet, issues a new device
credential, and offers revocation of old devices. TinyFrens must not request or store a user's Bankr
API key. Public social-profile resolution is useful corroboration but is not sufficient recovery
proof.

## Delivery order

1. Account Energy schema and deterministic math (this foundation).
2. Account-scoped verified wallets and safe merge/recovery semantics.
3. Ownership inventory that settles rate changes and fails closed when chain verification fails.
4. Adapt robot care/actions to account Energy and rename the companion stat to Stamina.
5. Convert purchases to instant Energy with an explicit legacy-credit migration.
6. Simulate and approve holding/staking/burn coefficients.
7. Audit, verify, and test contracts on Base Sepolia before any production fee routing.
