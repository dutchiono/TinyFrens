#Requires -Version 5.1
<#
.SYNOPSIS
  Base Sepolia testnet walkthrough for TinyFrens economy (TestFRENS + server status).

.DESCRIPTION
  There is NO fixed "send ETH here" project wallet. You create YOUR deployer key;
  Step 2 prints the address — fund THAT address with Base Sepolia ETH from a faucet.

  Production FRENS (mainnet, do not use on Sepolia): 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3

.EXAMPLE
  cd C:\Users\you\Documents\Playground\TinyFrens
  .\scripts\testnet-economy-runbook.ps1

.EXAMPLE
  .\scripts\testnet-economy-runbook.ps1 -SkipWalletCreate
#>
param(
    [switch]$SkipWalletCreate,
    [switch]$NonInteractive,
    [switch]$SkipFoundryInstall
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

$RpcUrl = if ($env:BASE_SEPOLIA_RPC) { $env:BASE_SEPOLIA_RPC } else { 'https://sepolia.base.org' }
$ChainId = 84532
$SecretsDir = Join-Path $RepoRoot '.secrets'
$DeployerFile = Join-Path $SecretsDir 'testnet-deployer.txt'
$DeploymentFile = Join-Path $SecretsDir 'testnet-deployment.json'

function Pause-Step([string]$Message) {
    if ($NonInteractive) { return }
    Write-Host ''
    Read-Host $Message
}

function Enable-LocalFoundryBin() {
    $bin = Join-Path $RepoRoot '.tools\foundry'
    if (Test-Path (Join-Path $bin 'forge.exe')) {
        $env:PATH = "$bin;$env:PATH"
        return $true
    }
    return $false
}

function Test-FoundryReady() {
    $forge = Get-Command forge -ErrorAction SilentlyContinue
    $cast = Get-Command cast -ErrorAction SilentlyContinue
    if (-not $forge -or -not $cast) { return $false }
    try {
        $v = (& forge --version 2>&1 | Out-String).Trim()
        return $v.Length -gt 0
    } catch { return $false }
}

function Ensure-Foundry() {
    Enable-LocalFoundryBin | Out-Null
    if (Test-FoundryReady) { return }
    if ($SkipFoundryInstall) {
        throw 'Foundry (forge + cast) not available. Run .\scripts\install-foundry-windows.ps1 or install foundryup, then retry.'
    }
    Write-Host '  Foundry not on PATH. Installing repo-local copy (~120 MB download)...' -ForegroundColor Yellow
    & (Join-Path $RepoRoot 'scripts\install-foundry-windows.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'install-foundry-windows.ps1 failed' }
    Enable-LocalFoundryBin | Out-Null
    if (-not (Test-FoundryReady)) {
        throw 'Foundry still missing after install. Close PowerShell, reopen, run install-foundry-windows.ps1 manually.'
    }
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing '$Name' on PATH. Run .\scripts\install-foundry-windows.ps1 first."
    }
}

function Get-DeployerAddress() {
    Require-Command cast
    if (-not $env:PRIVATE_KEY) { throw 'PRIVATE_KEY is not set. Run Step 2 first or set `$env:PRIVATE_KEY`.' }
    $addr = (cast wallet address --private-key $env:PRIVATE_KEY 2>&1 | Out-String).Trim()
    if ($addr -notmatch '^0x[a-fA-F0-9]{40}$') { throw "Could not derive address: $addr" }
    return $addr
}

Write-Host @'

================================================================================
  TinyFrens - Base Sepolia testnet runbook
================================================================================

  WHERE TO SEND ETH (testnet only):
  After Step 2, this script prints YOUR deployer address.
  Send Base Sepolia ETH to that address (not to TinyFrens, not to mainnet).

  Mainnet FRENS token (for later): 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3 on Base

================================================================================

'@ -ForegroundColor Cyan

# --- Step 1: Foundry ---
Write-Host '[Step 1/10] Foundry (forge + cast)' -ForegroundColor Yellow
Ensure-Foundry
Require-Command forge
Require-Command cast
Write-Host "  forge: $((forge --version 2>&1 | Select-Object -First 1))"
Write-Host "  cast:  $((cast --version 2>&1 | Select-Object -First 1))"
Write-Host '  OK' -ForegroundColor Green
Pause-Step 'Press Enter for Step 2'

# --- Step 2: Wallet ---
Write-Host '[Step 2/10] Deployer wallet (YOU fund this address)' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null
if ($env:PRIVATE_KEY) {
    Write-Host '  Using PRIVATE_KEY already set in this shell.'
} elseif (Test-Path $DeployerFile) {
    Write-Host "  Loading private key from $DeployerFile (gitignored)"
    $line = Get-Content $DeployerFile -Raw
    if ($line -match '(?m)^PRIVATE_KEY=(0x[a-fA-F0-9]+)$') {
        $env:PRIVATE_KEY = $Matches[1]
    } else {
        throw "Expected PRIVATE_KEY=0x... in $DeployerFile"
    }
} elseif (-not $SkipWalletCreate) {
    Write-Host '  Creating a NEW testnet-only wallet (saved under .secrets/, never commit).'
    $out = cast wallet new 2>&1 | Out-String
    Write-Host $out
    if ($out -notmatch 'Private key:\s*(0x[a-fA-F0-9]+)') { throw 'cast wallet new did not return a private key' }
    $env:PRIVATE_KEY = $Matches[1]
    if ($out -match 'Address:\s*(0x[a-fA-F0-9]{40})') { $newAddr = $Matches[1] }
    @(
        '# TinyFrens Base Sepolia deployer — TESTNET ONLY. Do not commit. Do not fund with mainnet ETH.'
        "PRIVATE_KEY=$($env:PRIVATE_KEY)"
        "ADDRESS=$newAddr"
    ) | Set-Content -Encoding utf8 $DeployerFile
    Write-Host "  Saved to $DeployerFile"
} else {
    throw 'Set `$env:PRIVATE_KEY = "0x..."` or run without -SkipWalletCreate'
}

$Deployer = Get-DeployerAddress
Write-Host ''
Write-Host '  >>> SEND BASE SEPOLIA ETH TO THIS ADDRESS <<<' -ForegroundColor Black -BackgroundColor Yellow
Write-Host "  $Deployer" -ForegroundColor White
Write-Host ''
Write-Host @'
  Faucets (pick one, connect wallet or paste address):
    https://www.alchemy.com/faucets/base-sepolia
    https://portal.cdp.coinbase.com/products/faucet
    https://faucet.quicknode.com/base/sepolia

  Need roughly 0.01–0.05 Sepolia ETH for deploy + a few mint txs.
'@
Pause-Step 'Press Enter after you requested faucet ETH'

# --- Step 3: Balance ---
Write-Host '[Step 3/10] Wait for Sepolia ETH balance' -ForegroundColor Yellow
$minWei = [bigint]0
$ok = $false
for ($i = 1; $i -le 30; $i++) {
    $bal = (cast balance $Deployer --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    Write-Host "  Attempt $i/30 balance (wei): $bal"
    try {
        if ([bigint]$bal -gt $minWei) { $ok = $true; break }
    } catch { }
    if (-not $NonInteractive) { Start-Sleep -Seconds 10 }
}
if (-not $ok) {
    Write-Host '  Balance still zero. You can re-run this script later from Step 3.' -ForegroundColor Red
    Pause-Step 'Press Enter to continue anyway (deploy will fail if still empty) or Ctrl+C'
}
else { Write-Host '  OK — deployer has ETH' -ForegroundColor Green }
Pause-Step 'Press Enter for Step 4'

# --- Step 4: Solidity dependencies ---
Write-Host '[Step 4/10] Sync Solidity dependencies (forge-std, ERC721A, solady)' -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $RepoRoot 'lib\solady\src\utils\LibString.sol'))) {
    # Submodules are pinned in .gitmodules + gitlinks at the committed versions.
    git submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) {
        foreach ($dep in @('foundry-rs/forge-std', 'chiru-labs/ERC721A', 'Vectorized/solady', 'OpenZeppelin/openzeppelin-contracts-upgradeable')) {
            forge install $dep --no-commit
            if ($LASTEXITCODE -ne 0) { throw "forge install $dep failed" }
        }
    }
}
Write-Host '  OK' -ForegroundColor Green
Pause-Step 'Press Enter for Step 5'

# --- Step 5: Compile + unit tests ---
Write-Host '[Step 5/10] Compile + run Foundry unit tests' -ForegroundColor Yellow
forge build
if ($LASTEXITCODE -ne 0) { throw 'forge build failed' }
forge test -vv
if ($LASTEXITCODE -ne 0) { throw 'forge test failed' }
Write-Host '  OK' -ForegroundColor Green
Pause-Step 'Press Enter for Step 6'

# --- Step 6: Deploy ---
Write-Host '[Step 6/10] Deploy TestFRENS to Base Sepolia' -ForegroundColor Yellow
$verifyArgs = @()
if ($env:BASESCAN_API_KEY) {
    $verifyArgs = @('--verify', '--etherscan-api-key', $env:BASESCAN_API_KEY)
    Write-Host '  Verification enabled (BASESCAN_API_KEY set).'
} else {
    Write-Host '  Skipping verify (optional: `$env:BASESCAN_API_KEY = "..."`).'
}

forge script contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS `
    --rpc-url $RpcUrl `
    --broadcast `
    @verifyArgs

if ($LASTEXITCODE -ne 0) { throw 'Deploy failed' }

$broadcast = Get-ChildItem -Path (Join-Path $RepoRoot 'broadcast\DeployTestFRENS.s.sol\84532') -Filter 'run-latest.json' -Recurse -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$tokenAddress = $null
if ($broadcast) {
    $json = Get-Content $broadcast.FullName -Raw | ConvertFrom-Json
    $created = $json.transactions | Where-Object { $_.contractName -eq 'TestFRENS' -and $_.transactionType -eq 'CREATE' } | Select-Object -First 1
    if ($created) { $tokenAddress = $created.contractAddress }
}
if (-not $tokenAddress) {
    Write-Host '  Could not read token address from broadcast/. Check terminal output for "TestFRENS" contract address.' -ForegroundColor Red
    $tokenAddress = Read-Host 'Paste deployed TestFRENS address (0x...)'
}
Write-Host "  TestFRENS deployed: $tokenAddress" -ForegroundColor Green
@{
    chainId     = $ChainId
    network     = 'base-sepolia'
    testFrens   = $tokenAddress
    deployer    = $Deployer
    deployedAt  = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -Encoding utf8 $DeploymentFile
Write-Host "  Wrote $DeploymentFile"
Pause-Step 'Press Enter for Step 7'

# --- Step 7: Mint test tokens ---
Write-Host '[Step 7/10] Mint 10,000 tfFRENS to your deployer' -ForegroundColor Yellow
$amount = '10000000000000000000000' # 10k * 10^18
cast send $tokenAddress "mint(address,uint256)" $Deployer $amount `
    --rpc-url $RpcUrl `
    --private-key $env:PRIVATE_KEY
if ($LASTEXITCODE -ne 0) { throw 'mint failed' }
$tb = (cast call $tokenAddress "balanceOf(address)(uint256)" $Deployer --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
Write-Host "  balanceOf(deployer): $tb wei"
Write-Host '  OK' -ForegroundColor Green
Pause-Step 'Press Enter for Step 8'

# --- Step 8: Server .env ---
Write-Host '[Step 8/10] Configure server for testnet economy' -ForegroundColor Yellow
$envFile = Join-Path $RepoRoot 'server\.env'
$block = @"

# --- TinyFrens testnet economy (added by testnet-economy-runbook.ps1) ---
ECONOMY_MODE=testnet
FRENS_TOKEN=$tokenAddress
CHAIN_ID=$ChainId
BASE_RPC_URL=$RpcUrl
ECONOMY_DEPOSITS=false
"@
if (Test-Path $envFile) {
    $existing = Get-Content $envFile -Raw
    if ($existing -notmatch 'ECONOMY_MODE=') {
        Add-Content -Path $envFile -Value $block
        Write-Host "  Appended economy vars to server\.env"
    } else {
        Write-Host '  server\.env already has ECONOMY_MODE — update FRENS_TOKEN manually if needed:'
        Write-Host "  FRENS_TOKEN=$tokenAddress"
    }
} else {
    Copy-Item (Join-Path $RepoRoot 'server\.env.example') $envFile
    Add-Content -Path $envFile -Value $block
    Write-Host '  Created server\.env from example + testnet block'
}
Pause-Step 'Press Enter for Step 9'

# --- Step 9: Python tests ---
Write-Host '[Step 9/10] Run server unit tests' -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot 'server')
try {
    python -m unittest discover -s . -v
    if ($LASTEXITCODE -ne 0) { throw 'unittest failed' }
}
finally { Pop-Location }
Write-Host '  OK' -ForegroundColor Green
Pause-Step 'Press Enter for Step 10'

# --- Step 10: Live economy status ---
Write-Host '[Step 10/10] Start server and check /api/economy/status' -ForegroundColor Yellow
Write-Host @'
  In a NEW PowerShell window:

    cd server
    `$env:ECONOMY_MODE = 'testnet'
    `$env:FRENS_TOKEN = '<token>'
    `$env:CHAIN_ID = '84532'
    pip install -r requirements.txt
    python app.py

  Then in this window (or browser):

'@ -replace '<token>', $tokenAddress

$statusUrl = 'http://127.0.0.1:8080/api/economy/status'
Write-Host "    Invoke-RestMethod $statusUrl | ConvertTo-Json"

if (-not $NonInteractive) {
    $start = Read-Host 'Start python app.py in background from this script? (y/N)'
    if ($start -eq 'y') {
        Push-Location (Join-Path $RepoRoot 'server')
        $env:ECONOMY_MODE = 'testnet'
        $env:FRENS_TOKEN = $tokenAddress
        $env:CHAIN_ID = "$ChainId"
        $job = Start-Job -ScriptBlock {
            param($dir, $token, $cid)
            Set-Location $dir
            $env:ECONOMY_MODE = 'testnet'
            $env:FRENS_TOKEN = $token
            $env:CHAIN_ID = $cid
            python app.py 2>&1
        } -ArgumentList (Join-Path $RepoRoot 'server'), $tokenAddress, "$ChainId"
        Start-Sleep -Seconds 2
        try {
            $status = Invoke-RestMethod -Uri $statusUrl -Method Get
            $status | ConvertTo-Json -Depth 5
            if (-not $status.enabled) { Write-Host '  WARNING: enabled is false — check FRENS_TOKEN and CHAIN_ID' -ForegroundColor Red }
            else { Write-Host '  Economy testnet enabled on server.' -ForegroundColor Green }
        } catch {
            Write-Host "  Could not reach server yet: $_"
        }
        Stop-Job $job | Out-Null
        Remove-Job $job | Out-Null
        Pop-Location
    }
}

Write-Host @'

================================================================================
  Done — checklist
================================================================================
  [ ] Deployer funded on Base Sepolia (your address, not a shared TinyFrens wallet)
  [ ] TestFRENS deployed + address in .secrets/testnet-deployment.json
  [ ] server/.env has ECONOMY_MODE=testnet + FRENS_TOKEN
  [ ] GET /api/economy/status shows enabled: true
  [ ] Optional: Basescan Sepolia — verify contract if you set BASESCAN_API_KEY

  Re-run anytime: .\scripts\testnet-economy-runbook.ps1 -SkipWalletCreate

================================================================================

'@ -ForegroundColor Cyan
