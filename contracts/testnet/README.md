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

## Server (testnet)

In `server/.env`:

```env
ECONOMY_MODE=testnet
FRENS_TOKEN=0xYourDeployedTestFRENS
CHAIN_ID=84532
BASE_RPC_URL=https://sepolia.base.org
```

Check `GET /api/economy/status` — `enabled` must be true and `mode` must be `testnet`. Leave `ECONOMY_MODE` unset in production until deposits are audited; never point test flows at mainnet FRENS without explicit approval.
