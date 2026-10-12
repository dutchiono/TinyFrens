# Base Sepolia testnet — PowerShell runbook

## Where do I send ETH?

**There is no TinyFrens team wallet.** You send **Base Sepolia test ETH** to **your own deployer address** — the one the runbook prints in Step 2.

- Network: **Base Sepolia** (not Base mainnet)
- Asset: **Sepolia ETH** (free from faucets)
- Mainnet FRENS `0x1A96226727a1D0a46334b3A4b3878B32B7659ba3` is unrelated to this faucet step

## One command (recommended)

From repo root in PowerShell:

```powershell
cd C:\Users\epj33\Documents\Playground\TinyFrens
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\testnet-economy-runbook.ps1
```

If Foundry is not installed globally, the runbook **auto-downloads** it into `.tools\foundry` (~120 MB) via `install-foundry-windows.ps1`. Or run that script alone first:

```powershell
.\scripts\install-foundry-windows.ps1
```

The script stops at each step until you press Enter. Step 2 prints:

```text
>>> SEND BASE SEPOLIA ETH TO THIS ADDRESS <<<
0xYourDeployer...
```

Fund that address, then continue.

### If you already have a test wallet

```powershell
$env:PRIVATE_KEY = "0xYourTestPrivateKey"
.\scripts\testnet-economy-runbook.ps1 -SkipWalletCreate
```

Never commit `PRIVATE_KEY`. Local saves go under `.secrets/` (gitignored).

## Manual copy-paste (same steps)

<details>
<summary>Expand full manual steps</summary>

### 1 — Install Foundry (Windows)

```powershell
cd C:\Users\epj33\Documents\Playground\TinyFrens
.\scripts\install-foundry-windows.ps1
$env:PATH = "$PWD\.tools\foundry;$env:PATH"
forge --version
cast --version
```

Alternative: Git Bash / WSL with `foundryup` from https://book.getfoundry.sh/getting-started/installation

### 2 — Repo + wallet

```powershell
cd C:\Users\epj33\Documents\Playground\TinyFrens
cast wallet new
# Save Private key locally. Fund the printed Address on Base Sepolia.
$env:PRIVATE_KEY = "0x..."
cast wallet address --private-key $env:PRIVATE_KEY
```

### 3 — Faucet

Open one of:

- https://www.alchemy.com/faucets/base-sepolia
- https://portal.cdp.coinbase.com/products/faucet
- https://faucet.quicknode.com/base/sepolia

Paste **your deployer address**. Wait until balance &gt; 0:

```powershell
$env:BASE_SEPOLIA_RPC = "https://sepolia.base.org"
cast balance (cast wallet address --private-key $env:PRIVATE_KEY) --rpc-url $env:BASE_SEPOLIA_RPC
```

### 4 — Dependencies + compile + tests + deploy

```powershell
# Deps are pinned as submodules (forge-std, ERC721A, solady) + remappings.txt
git submodule update --init --recursive

forge build
forge test -vv          # 70 unit tests (TestFRENS + economy proxies + deposit router)

forge script contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS `
  --rpc-url $env:BASE_SEPOLIA_RPC `
  --broadcast
```

Copy the deployed **TestFRENS** address from the output.

### 5 — Mint test tokens

```powershell
$token = "0xDeployedTestFRENS"
$me = cast wallet address --private-key $env:PRIVATE_KEY
cast send $token "mint(address,uint256)" $me 10000000000000000000000 `
  --rpc-url $env:BASE_SEPOLIA_RPC --private-key $env:PRIVATE_KEY
```

### 5b — Deploy economy proxies (Treasury + JackpotVault + DepositRouter)

```powershell
forge script contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy `
  --rpc-url $env:BASE_SEPOLIA_RPC `
  --broadcast
```

Logs print `treasuryProxy`, `vaultProxy`, `routerProxy`, `sessionImpl`. Your server controller
(`GAME_CONTROLLER`) must call `DepositRouter.createSession(sessionId, token)` per payment; open the
session with `token = address(0)` for ETH deposits or the TestFRENS address for ERC-20 deposits.

### 6 — Server

```powershell
cd server
pip install -r requirements.txt
$env:ECONOMY_MODE = "testnet"
$env:FRENS_TOKEN = "0xDeployedTestFRENS"
$env:CHAIN_ID = "84532"
python app.py
```

New window:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/economy/status | ConvertTo-Json
```

Expect `"enabled": true` and `"mode": "testnet"`.

### 7 — Unit tests

```powershell
cd C:\Users\epj33\Documents\Playground\TinyFrens\server
python -m unittest discover -s . -v
```

</details>

## Optional: verify on Basescan Sepolia

```powershell
$env:BASESCAN_API_KEY = "your-api-key"
# Re-run deploy with --verify, or use forge verify-contract ...
```

## Troubleshooting

| Problem | Fix |
|--------|-----|
| `forge` not found | Install Foundry; reopen terminal |
| Deploy out of gas | Request more Sepolia ETH to **your** deployer |
| `enabled: false` | `FRENS_TOKEN` must be valid `0x` + 40 hex; `ECONOMY_MODE=testnet` |
| Used mainnet ETH | Wrong network — use **Base Sepolia** faucet only |
