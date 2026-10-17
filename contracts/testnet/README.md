# Base Sepolia test FRENS

Production utility token (do not use on Sepolia for real value):

| | |
|---|---|
| Network | Base (`chainId` 8453) |
| Contract | `0x1A96226727a1D0a46334b3A4b3878B32B7659ba3` |
| Symbol | FRENS (18 decimals) |

All economy integration work runs on **Base Sepolia** (`84532`) first. Deploy `TestFRENS.sol`, point the server at it, then exercise deposits/jackpots before touching mainnet FRENS.

**PowerShell walkthrough:** run [`scripts/testnet-economy-runbook.ps1`](../../scripts/testnet-economy-runbook.ps1) from repo root, or read [TESTNET-POWERSHELL.md](./TESTNET-POWERSHELL.md).  
**Where to send ETH:** your **own deployer address** (printed in Step 2) — not a shared TinyFrens wallet.

## Local pre-flight (no faucet, no testnet ETH)

Run this first — it proves the toolchain, contracts, and tests work before spending faucet ETH:

```powershell
git submodule update --init --recursive   # or: forge install ...
forge build
forge test -vv                            # contracts/test/*.t.sol (TestFRENS, Treasury, JackpotVault, DepositRouter)
```

Dependencies are pinned as submodules and resolved via [`remappings.txt`](../../remappings.txt): `forge-std`, `ERC721A` (`erc721a/`), and `solady` (`solady/`). The full repo (`contracts/*.sol`) now compiles under Foundry.

Optionally deploy to a throwaway local chain — same script, zero funds:

```powershell
anvil --silent
# in another shell:
$env:PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' # anvil account 0
forge script contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS --rpc-url http://127.0.0.1:8545 --broadcast
```

## Deploy TestFRENS (Foundry)

Install [Foundry](https://book.getfoundry.sh/getting-started/installation), then from the repo root:

```powershell
$env:PRIVATE_KEY = "<deployer key with Base Sepolia ETH>"
$env:BASE_SEPOLIA_RPC = "https://sepolia.base.org"
forge script contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS `
  --rpc-url $env:BASE_SEPOLIA_RPC `
  --broadcast `
  --verify
```

The script sets the deployer as `minter`. Mint test balances with:

```powershell
cast send <TestFRENS_ADDRESS> "mint(address,uint256)" <recipient> 1000000000000000000000 `
  --rpc-url $env:BASE_SEPOLIA_RPC `
  --private-key $env:PRIVATE_KEY
```

## Deploy economy proxies (Treasury + JackpotVault + DepositRouter)

All are **UUPS** contracts deployed as implementation + ERC1967 proxy. The proxy is the address the server and users talk to; the implementation is what gets verified on Basescan. `Treasury`, `JackpotVault`, and `DepositRouter` all initialize with the same `owner` (proxy admin) and `controller` (the only address allowed to move funds / open sessions — the game server on testnet). `DeployEconomy` also deploys the `DepositSession` implementation that `DepositRouter` clones per session.

```powershell
$env:PRIVATE_KEY = "<deployer key with Base Sepolia ETH>"
$env:BASE_SEPOLIA_RPC = "https://sepolia.base.org"
# optional; default to deployer:
# $env:TREASURY_OWNER = "0x..."   # multisig/timelock on mainnet
# $env:GAME_CONTROLLER = "0x..."  # game server signer

forge script contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy `
  --rpc-url $env:BASE_SEPOLIA_RPC `
  --broadcast `
  --verify
```

Logs print `treasuryImpl`, `treasuryProxy`, `vaultImpl`, `vaultProxy`, `sessionImpl`, `routerImpl`, `routerProxy`. Verify the **implementations** (the proxies are thin ERC1967 forwarders); `forge`'s `--verify` may need the impl addresses passed explicitly.

The addresses and provider-specific verification results for the existing Base Sepolia rehearsal are recorded in [`../config/testnet-economy.json`](../config/testnet-economy.json). Run `npm run audit:testnet-contracts` from `server-ts/` to recheck the deployed bytecode, EIP-1967 implementation slots, control addresses, pause state, router wiring, and renderer relationships. The config file is an audit record, not a deployment input. Do not enable deposits merely because an address appears there.

Then in `server/.env`:

```env
TREASURY_PROXY=0x...
JACKPOT_VAULT_PROXY=0x...
DEPOSIT_ROUTER_PROXY=0x...
GAME_CONTROLLER=0x...
```

### Deposit sessions

The server auto-provisions sessions when configured with the router + controller key:

```env
DEPOSIT_ROUTER_PROXY=0x...           # from DeployEconomy.s.sol
GAME_CONTROLLER_PRIVATE_KEY=0x...    # same wallet as the deployer (owner+controller on testnet)
BASE_RPC_URL=https://sepolia.base.org
ECONOMY_INDEXER_SECRET=change-me     # sent as X-Indexer-Secret to /api/deposits/confirm
```

With these set, `POST /api/deposits/open` signs a `DepositRouter.createSession` call and returns
a fresh clone address. The clone forwards ETH to the Treasury on `receive` (ETH session, `token = address(0)`)
or holds FRENS until anyone calls `sweep()` (ERC-20 session). `server/test_deposit_allocator.py` proves the
full ERC-20 and ETH paths end-to-end against anvil.

`DEPOSIT_SESSION_ADDRESSES` remains a legacy-credit compatibility path. Instant-Energy purchases
fail closed unless the allocator returns the router's unique on-chain session id.

### Upgrading

Both proxies are UUPS and gated to `owner` via `_authorizeUpgrade` on mainnet. `Owner` should be a multisig/timelock; on testnet it defaults to the deployer. Upgrades must come from a new implementation that preserves storage layout (OZ v5 uses ERC-7201 namespaced storage, so appending is safe).

## Server (testnet)

In `server/.env`:

```env
ECONOMY_MODE=testnet
FRENS_TOKEN=0xYourDeployedTestFRENS
CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
```

Check `GET /api/economy/status` — `enabled` must be true and `mode` must be `testnet`. Leave `ECONOMY_MODE` unset in production until deposits are audited; never point test flows at mainnet FRENS without explicit approval.
