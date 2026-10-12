#Requires -Version 5.1
<#
.SYNOPSIS
  Base Sepolia testnet walkthrough for TinyFrens: TestFRENS, economy proxies, the
  real TinyFrensNFT collection, server config, and verification.

.DESCRIPTION
  Interactive, one step at a time. Every broadcast waits for an on-chain receipt
  (status 0x1) and checks the deployed address is live BEFORE moving on. Contract
  verification is its own step with retries (explorers lag the chain — that is why
  "verification failed" happens when you broadcast+verify in one shot).

  There is NO fixed "send ETH here" project wallet. You create YOUR deployer key;
  Step 2 prints the address — fund THAT address with Base Sepolia ETH from a faucet.

  Production FRENS (mainnet, do not use on Sepolia): 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3

.PARAMETER From
  Start at step N (go back / resume after a failure). Deployed addresses are read
  back from .secrets/testnet-deployment.json, so already-completed deploys are reused.

.PARAMETER To
  Stop after step N.

.PARAMETER SkipVerify
  Skip the Basescan verification step (it prints the exact commands so you can run
  them later). By default verification runs with retries.

.PARAMETER BASESCAN_API_KEY
  Basescan Sepolia API key. Also read from $env:BASESCAN_API_KEY.

.EXAMPLE
  .\scripts\testnet-economy-runbook.ps1

.EXAMPLE
  .\scripts\testnet-economy-runbook.ps1 -From 8      # resume at the economy deploy

.EXAMPLE
  .\scripts\testnet-economy-runbook.ps1 -SkipWalletCreate -SkipVerify
#>
param(
    [switch]$SkipWalletCreate,
    [switch]$NonInteractive,
    [switch]$SkipFoundryInstall,
    [switch]$SkipVerify,
    [int]$From = 0,
    [int]$To = 0,
    [string]$BASESCAN_API_KEY
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

$RpcUrl = if ($env:BASE_SEPOLIA_RPC) { $env:BASE_SEPOLIA_RPC } else { 'https://sepolia.base.org' }
$ChainId = 84532
$SecretsDir = Join-Path $RepoRoot '.secrets'
$DeployerFile = if ($env:TINYFRENS_DEPLOYER_FILE) { $env:TINYFRENS_DEPLOYER_FILE } else { Join-Path $SecretsDir 'testnet-deployer.txt' }
$DeploymentFile = if ($env:TINYFRENS_DEPLOYMENT_FILE) { $env:TINYFRENS_DEPLOYMENT_FILE } else { Join-Path $SecretsDir 'testnet-deployment.json' }

if ($BASESCAN_API_KEY) { $env:BASESCAN_API_KEY = $BASESCAN_API_KEY }
if ($env:BASESCAN_API_KEY) { $env:ETHERSCAN_API_KEY = $env:BASESCAN_API_KEY }

function Pause-Step([string]$Message) {
    if ($NonInteractive) { return }
    Write-Host ''
    Read-Host $Message | Out-Null
}

function Enable-LocalFoundryBin() {
    $bin = Join-Path $RepoRoot '.tools\foundry'
    if (Test-Path (Join-Path $bin 'forge.exe')) { $env:PATH = "$bin;$env:PATH"; return $true }
    return $false
}

function Test-FoundryReady() {
    $forge = Get-Command forge -ErrorAction SilentlyContinue
    $cast = Get-Command cast -ErrorAction SilentlyContinue
    if (-not $forge -or -not $cast) { return $false }
    try { return ((& forge --version 2>&1 | Out-String).Trim().Length -gt 0) } catch { return $false }
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
    if (-not (Test-FoundryReady)) { throw 'Foundry still missing after install.' }
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

function Resolve-Deployer {
    if ($script:Deployer) { return $script:Deployer }
    if (-not $env:PRIVATE_KEY -and (Test-Path $DeployerFile)) {
        $line = Get-Content $DeployerFile -Raw
        if ($line -match '(?m)^PRIVATE_KEY=(0x[a-fA-F0-9]+)$') { $env:PRIVATE_KEY = $Matches[1] }
    }
    if ($env:PRIVATE_KEY) { $script:Deployer = Get-DeployerAddress }
    if (-not $script:Deployer) { throw 'No deployer key. Run from Step 2 first.' }
    return $script:Deployer
}

# --- deployment job file (idempotent resume) --------------------------------
function Get-Job {
    if (Test-Path $DeploymentFile) {
        try { return Get-Content $DeploymentFile -Raw | ConvertFrom-Json } catch { }
    }
    return [pscustomobject]@{}
}

function Get-JobValue([string]$Key) {
    $job = Get-Job
    if ($job.PSObject.Properties.Name -contains $Key) { return $job.$Key }
    return $null
}

function Save-Job([hashtable]$Updates) {
    $job = Get-Job
    $obj = @{}
    foreach ($p in $job.PSObject.Properties) { $obj[$p.Name] = $p.Value }
    foreach ($k in $Updates.Keys) { $obj[$k] = $Updates[$k] }
    $obj['chainId'] = $ChainId
    $obj['network'] = 'base-sepolia'
    $obj['updatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
    [pscustomobject]$obj | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $DeploymentFile
}

# --- rpc helpers ------------------------------------------------------------
function Get-ConsoleValue([string]$Output, [string]$Key) {
    $m = [regex]::Match($Output, "(?m)^\s*$([regex]::Escape($Key))\s+(0x[a-fA-F0-9]{40})")
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Invoke-ForgeScript([string]$Script) {
    Write-Host "  forge script $Script --broadcast" -ForegroundColor DarkGray
    $out = & forge script $Script --rpc-url $RpcUrl --broadcast 2>&1 | Out-String
    Write-Host $out
    if ($LASTEXITCODE -ne 0) { throw "forge script failed ($Script):`n$out" }
    return $out
}

function Wait-TxMined([string]$TxHash, [int]$TimeoutSec = 180) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $receipt = & cast receipt --json --rpc-url $RpcUrl $TxHash 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $receipt.Trim()) {
            try { $r = $receipt | ConvertFrom-Json } catch { $r = $null }
            if ($r -and $r.status) { return $r }
        }
        Start-Sleep -Seconds 4
    }
    throw "Timed out waiting for tx $TxHash to be mined"
}

function Wait-AllMined([string]$ScriptName) {
    $path = Join-Path $RepoRoot "broadcast\$ScriptName\84532\run-latest.json"
    if (-not (Test-Path $path)) { throw "Missing $path (did the broadcast run?)" }
    $txs = (Get-Content $path -Raw | ConvertFrom-Json).transactions
    if (-not $txs) { throw "No transactions in $path" }
    foreach ($t in $txs) {
        if (-not $t.hash) { continue }
        $r = Wait-TxMined $t.hash
        if ($r.status -ne '0x1') { throw "tx $($t.hash) reverted (status $($r.status))" }
        Write-Host ("  mined {0}  block={1}  status=0x1" -f $t.hash, $r.blockNumber) -ForegroundColor DarkGray
    }
}

function Assert-Live([string]$Address, [string]$Label) {
    $code = (cast code $Address --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    if ($code -eq '0x' -or $code.Length -lt 4) { throw "$Label at $Address has no code on-chain" }
    Write-Host "  $Label live at $Address" -ForegroundColor DarkGray
}

# --- verification (separate from broadcast; waits for explorer) -------------
function Invoke-Verify([string]$Address, [string]$Contract, [string]$Label, [int]$Attempts = 10, [int]$DelaySec = 20) {
    if (-not $env:BASESCAN_API_KEY) { return @{ label = $Label; status = 'skipped'; detail = 'no BASESCAN_API_KEY' } }
    for ($i = 1; $i -le $Attempts; $i++) {
        $out = & forge verify-contract $Address $Contract `
            --chain $ChainId --etherscan-api-key $env:BASESCAN_API_KEY --rpc-url $RpcUrl 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) { Write-Host "  VERIFIED $Label" -ForegroundColor Green; return @{ label = $Label; status = 'verified' } }
        if ($out -match '(?i)already verified') { Write-Host "  VERIFIED $Label (already)" -ForegroundColor Green; return @{ label = $Label; status = 'verified' } }
        $retryable = $out -match '(?i)pending|not been indexed|not found|try again|later|rate limit|review|could not'
        $first = ($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
        if ($i -lt $Attempts -and $retryable) {
            Write-Host ("  [{0}] attempt {1}/{2} not ready: {3} — waiting {4}s for the explorer..." -f $Label, $i, $Attempts, $first, $DelaySec) -ForegroundColor Yellow
            Start-Sleep -Seconds $DelaySec
            continue
        }
        Write-Host "  FAILED ${Label}: $first" -ForegroundColor Red
        return @{ label = $Label; status = 'failed'; detail = $first }
    }
    return @{ label = $Label; status = 'failed'; detail = 'retries exhausted' }
}

# --- .env upsert ------------------------------------------------------------
function Set-EnvVars([string]$Path, [System.Collections.IDictionary]$Map) {
    $lines = @()
    if (Test-Path $Path) { $lines = @(Get-Content $Path) }
    $keep = foreach ($l in $lines) {
        $isManaged = $false
        foreach ($k in $Map.Keys) { if ($l -match "^\s*$([regex]::Escape($k))\s*=") { $isManaged = $true } }
        if (-not $isManaged) { $l }
    }
    $block = @('', '# --- TinyFrens testnet (managed by testnet-economy-runbook.ps1) ---')
    foreach ($k in $Map.Keys) { $block += "$k=$($Map[$k])" }
    ($keep + $block) -join "`n" | Set-Content -Encoding utf8 $Path
}

# ============================================================================
$Deployer = $null
$VerifyResults = @()
$EconomyAddr = @{}

# ---- Step functions ----
function Step-1-Foundry {
    Write-Host '[Step 1] Foundry (forge + cast)' -ForegroundColor Yellow
    Ensure-Foundry; Require-Command forge; Require-Command cast
    Write-Host "  forge: $((forge --version 2>&1 | Select-Object -First 1))"
    Write-Host "  cast:  $((cast --version 2>&1 | Select-Object -First 1))"
    Write-Host '  OK' -ForegroundColor Green
}

function Step-2-Wallet {
    Write-Host '[Step 2] Deployer wallet (YOU fund this address)' -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null
    if ($env:PRIVATE_KEY) {
        Write-Host '  Using PRIVATE_KEY already set in this shell.'
    } elseif (Test-Path $DeployerFile) {
        Write-Host "  Loading private key from $DeployerFile (gitignored)"
        $line = Get-Content $DeployerFile -Raw
        if ($line -match '(?m)^PRIVATE_KEY=(0x[a-fA-F0-9]+)$') { $env:PRIVATE_KEY = $Matches[1] }
        else { throw "Expected PRIVATE_KEY=0x... in $DeployerFile" }
    } elseif (-not $SkipWalletCreate) {
        Write-Host '  Creating a NEW testnet-only wallet (saved under .secrets/, never commit).'
        $out = cast wallet new 2>&1 | Out-String
        Write-Host $out
        if ($out -notmatch 'Private key:\s*(0x[a-fA-F0-9]+)') { throw 'cast wallet new did not return a private key' }
        $env:PRIVATE_KEY = $Matches[1]
        if ($out -match 'Address:\s*(0x[a-fA-F0-9]{40})') { $newAddr = $Matches[1] }
        @(
            '# TinyFrens Base Sepolia deployer - TESTNET ONLY. Do not commit. Do not fund with mainnet ETH.'
            "PRIVATE_KEY=$($env:PRIVATE_KEY)"
            "ADDRESS=$newAddr"
        ) | Set-Content -Encoding utf8 $DeployerFile
        Write-Host "  Saved to $DeployerFile"
    } else {
        throw 'Set `$env:PRIVATE_KEY = "0x..."` or run without -SkipWalletCreate'
    }
    $script:Deployer = Get-DeployerAddress
    Write-Host ''
    Write-Host '  >>> SEND BASE SEPOLIA ETH TO THIS ADDRESS <<<' -ForegroundColor Black -BackgroundColor Yellow
    Write-Host "  $($script:Deployer)" -ForegroundColor White
    Write-Host ''
    Write-Host @'
  Faucets (pick one, connect wallet or paste address):
    https://www.alchemy.com/faucets/base-sepolia
    https://portal.cdp.coinbase.com/products/faucet
    https://faucet.quicknode.com/base/sepolia

  Need roughly 0.02-0.05 Sepolia ETH for deploy + a few mint txs.
'@
    Pause-Step 'Press Enter after you requested faucet ETH'
}

function Step-3-Balance {
    Write-Host '[Step 3] Wait for Sepolia ETH balance' -ForegroundColor Yellow
    if (-not $script:Deployer) { $script:Deployer = Get-DeployerAddress }
    $ok = $false
    for ($i = 1; $i -le 30; $i++) {
        $bal = (cast balance $script:Deployer --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
        Write-Host "  Attempt $i/30 balance (wei): $bal"
        try { if ([bigint]$bal -gt 0) { $ok = $true; break } } catch { }
        if (-not $NonInteractive) { Start-Sleep -Seconds 10 }
    }
    if (-not $ok) {
        Write-Host '  Balance still zero. Fund the address, then re-run with -From 3.' -ForegroundColor Red
        Pause-Step 'Press Enter to continue anyway (deploys will fail if still empty) or Ctrl+C'
    } else { Write-Host '  OK - deployer has ETH' -ForegroundColor Green }
}

function Step-4-Deps {
    Write-Host '[Step 4] Sync Solidity dependencies (forge-std, ERC721A, solady)' -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $RepoRoot 'lib\solady\src\utils\LibString.sol'))) {
        git submodule update --init --recursive
        if ($LASTEXITCODE -ne 0) {
            foreach ($dep in @('foundry-rs/forge-std', 'chiru-labs/ERC721A', 'Vectorized/solady', 'OpenZeppelin/openzeppelin-contracts-upgradeable')) {
                forge install $dep --no-commit
                if ($LASTEXITCODE -ne 0) { throw "forge install $dep failed" }
            }
        }
    }
    Write-Host '  OK' -ForegroundColor Green
}

function Step-5-Tests {
    Write-Host '[Step 5] Compile + Foundry unit tests' -ForegroundColor Yellow
    forge build; if ($LASTEXITCODE -ne 0) { throw 'forge build failed' }
    forge test -vv; if ($LASTEXITCODE -ne 0) { throw 'forge test failed' }
    Write-Host '  OK' -ForegroundColor Green
}

function Step-6-DeployToken {
    Write-Host '[Step 6] Deploy TestFRENS to Base Sepolia' -ForegroundColor Yellow
    Resolve-Deployer | Out-Null
    $existing = Get-JobValue 'testFrens'
    if ($existing) { Write-Host "  Reusing TestFRENS from job file: $existing" -ForegroundColor DarkGray; $script:Token = $existing; return }
    $out = Invoke-ForgeScript 'contracts/testnet/script/DeployTestFRENS.s.sol:DeployTestFRENS'
    Wait-AllMined 'DeployTestFRENS.s.sol'
    $broadcast = Join-Path $RepoRoot 'broadcast\DeployTestFRENS.s.sol\84532\run-latest.json'
    $created = ((Get-Content $broadcast -Raw | ConvertFrom-Json).transactions |
        Where-Object { $_.contractName -eq 'TestFRENS' -and $_.transactionType -eq 'CREATE' } | Select-Object -First 1)
    if (-not $created) { throw 'Could not find TestFRENS in broadcast/DeployTestFRENS.s.sol/84532/run-latest.json' }
    $token = $created.contractAddress
    Assert-Live $token 'TestFRENS'
    Save-Job @{ testFrens = $token; deployer = $script:Deployer }
    Write-Host "  TestFRENS deployed: $token" -ForegroundColor Green
    $script:Token = $token
}

function Step-7-MintToken {
    Write-Host '[Step 7] Mint 10,000 tfFRENS to your deployer' -ForegroundColor Yellow
    Resolve-Deployer | Out-Null
    if (-not $script:Token) { $script:Token = Get-JobValue 'testFrens' }
    if (-not $script:Token) { throw 'No TestFRENS address — run Step 6 first (-From 6).' }
    $amount = '10000000000000000000000' # 10k * 10^18
    $bal = (cast call $script:Token "balanceOf(address)(uint256)" $script:Deployer --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    if ([bigint]($bal -split '\s')[0] -ge [bigint]$amount) {
        Write-Host "  Deployer already holds >= 10,000 tfFRENS ($bal). Skipping." -ForegroundColor DarkGray
    } else {
        cast send $script:Token "mint(address,uint256)" $script:Deployer $amount --rpc-url $RpcUrl --private-key $env:PRIVATE_KEY
        if ($LASTEXITCODE -ne 0) { throw 'mint failed' }
    }
    $tb = (cast call $script:Token "balanceOf(address)(uint256)" $script:Deployer --rpc-url $RpcUrl 2>&1 | Out-String).Trim()
    Write-Host "  balanceOf(deployer): $tb wei" -ForegroundColor Green
}

function Step-8-DeployEconomy {
    Write-Host '[Step 8] Deploy economy proxies (Treasury + JackpotVault + DepositRouter)' -ForegroundColor Yellow
    Resolve-Deployer | Out-Null
    $existing = Get-JobValue 'routerProxy'
    if ($existing) { Write-Host "  Reusing economy from job file (router $existing)" -ForegroundColor DarkGray; $script:EconomyAddr = Get-Job; return }
    $out = Invoke-ForgeScript 'contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy'
    Wait-AllMined 'DeployEconomy.s.sol'
    $map = @{}
    foreach ($k in @('treasuryProxy', 'vaultProxy', 'routerProxy', 'treasuryImpl', 'vaultImpl', 'routerImpl', 'sessionImpl')) {
        $map[$k] = Get-ConsoleValue $out $k
    }
    if (-not $map['routerProxy']) { throw 'Could not parse routerProxy from DeployEconomy output' }
    foreach ($k in @('treasuryProxy', 'vaultProxy', 'routerProxy')) { Assert-Live $map[$k] $k }
    Save-Job $map
    $script:EconomyAddr = Get-Job
    Write-Host "  treasuryProxy: $($map['treasuryProxy'])" -ForegroundColor Green
    Write-Host "  vaultProxy:    $($map['vaultProxy'])" -ForegroundColor Green
    Write-Host "  routerProxy:   $($map['routerProxy'])" -ForegroundColor Green
}

function Step-9-DeployNFT {
    Write-Host '[Step 9] Deploy TinyFrensNFT (the real 100% on-chain collection)' -ForegroundColor Yellow
    Resolve-Deployer | Out-Null
    $existing = Get-JobValue 'tinyFrensNft'
    if ($existing) { Write-Host "  Reusing TinyFrensNFT from job file: $existing" -ForegroundColor DarkGray; return }
    $out = Invoke-ForgeScript 'contracts/testnet/script/DeployTinyFrensNFT.s.sol:DeployTinyFrensNFT'
    Wait-AllMined 'DeployTinyFrensNFT.s.sol'
    $nft = Get-ConsoleValue $out 'nftAddress'
    if (-not $nft) {
        $broadcast = Join-Path $RepoRoot 'broadcast\DeployTinyFrensNFT.s.sol\84532\run-latest.json'
        $created = ((Get-Content $broadcast -Raw | ConvertFrom-Json).transactions |
            Where-Object { $_.contractName -eq 'TinyFrensNFT' -and $_.transactionType -eq 'CREATE' } | Select-Object -First 1)
        if ($created) { $nft = $created.contractAddress }
    }
    if (-not $nft) { throw 'Could not determine TinyFrensNFT address' }
    Assert-Live $nft 'TinyFrensNFT'
    Save-Job @{ tinyFrensNft = $nft }
    Write-Host "  TinyFrensNFT deployed: $nft" -ForegroundColor Green
    Write-Host "  View: https://base-sepolia.blockscout.com/token/$nft" -ForegroundColor Cyan
}

function Step-10-Verify {
    Write-Host '[Step 10] Verify contracts on Basescan Sepolia (with retries)' -ForegroundColor Yellow
    if ($SkipVerify) { Write-Host '  -SkipVerify set; skipping (Step prints manual commands below).' -ForegroundColor Yellow; $script:VerifySkip = $true; return }
    if (-not $env:BASESCAN_API_KEY) {
        Write-Host '  No BASESCAN_API_KEY. Verification needs a Basescan (Sepolia) API key.' -ForegroundColor Yellow
        if (-not $NonInteractive) {
            $k = Read-Host '  Paste BASESCAN_API_KEY (or Enter to skip)'
            if ($k) { $env:BASESCAN_API_KEY = $k; $env:ETHERSCAN_API_KEY = $k }
        }
    }
    $job = Get-Job
    $items = @(
        @{ addr = $job.testFrens;    c = 'contracts/testnet/TestFRENS.sol:TestFRENS';                    label = 'TestFRENS' },
        @{ addr = $job.tinyFrensNft; c = 'contracts/TinyFrensNFT.sol:TinyFrensNFT';                      label = 'TinyFrensNFT' },
        @{ addr = $job.treasuryImpl; c = 'contracts/economy/Treasury.sol:Treasury';                      label = 'Treasury(impl)' },
        @{ addr = $job.vaultImpl;    c = 'contracts/economy/JackpotVault.sol:JackpotVault';              label = 'JackpotVault(impl)' },
        @{ addr = $job.routerImpl;   c = 'contracts/economy/DepositRouter.sol:DepositRouter';            label = 'DepositRouter(impl)' },
        @{ addr = $job.sessionImpl;  c = 'contracts/economy/DepositSession.sol:DepositSession';          label = 'DepositSession(impl)' }
    )
    foreach ($it in $items) {
        if (-not $it.addr) { Write-Host "  skip $($it.label) (address unknown)" -ForegroundColor DarkGray; continue }
        $script:VerifyResults += (Invoke-Verify $it.addr $it.c $it.label)
    }
    $failed = @($script:VerifyResults | Where-Object { $_.status -eq 'failed' })
    if ($failed.Count -gt 0) {
        Write-Host "  $($failed.Count) contract(s) not verified yet — re-run with -From 10." -ForegroundColor Yellow
    } else {
        Write-Host '  All contracts verified.' -ForegroundColor Green
    }
}

function Step-11-Env {
    Write-Host '[Step 11] Configure server for testnet economy + collection' -ForegroundColor Yellow
    $job = Get-Job
    $envFile = Join-Path $RepoRoot 'server\.env'
    if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $RepoRoot 'server\.env.example') $envFile }
    $map = [ordered]@{
        ECONOMY_MODE          = 'testnet'
        FRENS_TOKEN           = $job.testFrens
        CHAIN_ID              = $ChainId
        BASE_RPC_URL          = $RpcUrl
        ECONOMY_DEPOSITS      = 'false'
        TINYFRENS_NFT_ADDRESS = $job.tinyFrensNft
    }
    Set-EnvVars $envFile $map
    Write-Host "  Wrote economy + NFT vars to $envFile" -ForegroundColor Green
    Write-Host '  To go live with deposits later, add (uncomment in .env):' -ForegroundColor DarkGray
    Write-Host '    DEPOSIT_ROUTER_PROXY=' + $job.routerProxy -ForegroundColor DarkGray
    Write-Host '    GAME_CONTROLLER_PRIVATE_KEY=<your deployer key>' -ForegroundColor DarkGray
    Write-Host '    INDEXER_ENABLED=auto' -ForegroundColor DarkGray
}

function Step-12-ServerTests {
    Write-Host '[Step 12] Run server unit tests' -ForegroundColor Yellow
    Push-Location (Join-Path $RepoRoot 'server')
    try {
        python -m unittest discover -s . -v
        if ($LASTEXITCODE -ne 0) { throw 'unittest failed' }
    } finally { Pop-Location }
    Write-Host '  OK' -ForegroundColor Green
}

function Step-13-Smoke {
    Write-Host '[Step 13] Smoke check the running server (optional)' -ForegroundColor Yellow
    Write-Host @'
  Start the relay in a NEW window:
    cd server
    pip install -r requirements.txt
    python app.py

  Then check:
    Invoke-RestMethod http://127.0.0.1:8080/api/economy/status | ConvertTo-Json
    Invoke-RestMethod http://127.0.0.1:8080/api/nft/uri?tokenId=1 | ConvertTo-Json

  Expect economy enabled:true (mode testnet) and nft/uri minted:true for a creator-reserve token.
'@
    try {
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/economy/status' -Method Get -TimeoutSec 4
        Write-Host "  Server up. enabled=$($status.enabled) mode=$($status.mode)" -ForegroundColor Green
    } catch {
        Write-Host '  Server not running yet (start it, then re-run -From 13 if you want the check).' -ForegroundColor DarkGray
    }
}

function Step-14-Share {
    Write-Host '[Step 14] Where to view the collection' -ForegroundColor Yellow
    $job = Get-Job
    Write-Host "  In-app gallery:   http://127.0.0.1:8080/gallery.html?nft=$($job.tinyFrensNft)" -ForegroundColor Cyan
    Write-Host "  Blockscout NFT:   https://base-sepolia.blockscout.com/token/$($job.tinyFrensNft)" -ForegroundColor Cyan
    Write-Host '  OpenSea does not index Base Sepolia, so Blockscout is the on-chain viewer.' -ForegroundColor DarkGray
}

$Steps = @(
    @{ n = 1;  name = 'Foundry tooling';        run = { Step-1-Foundry } },
    @{ n = 2;  name = 'Deployer wallet';        run = { Step-2-Wallet } },
    @{ n = 3;  name = 'Wait for balance';       run = { Step-3-Balance } },
    @{ n = 4;  name = 'Solidity dependencies';  run = { Step-4-Deps } },
    @{ n = 5;  name = 'Compile + tests';        run = { Step-5-Tests } },
    @{ n = 6;  name = 'Deploy TestFRENS';       run = { Step-6-DeployToken } },
    @{ n = 7;  name = 'Mint tfFRENS';           run = { Step-7-MintToken } },
    @{ n = 8;  name = 'Deploy economy';         run = { Step-8-DeployEconomy } },
    @{ n = 9;  name = 'Deploy TinyFrensNFT';    run = { Step-9-DeployNFT } },
    @{ n = 10; name = 'Verify on Basescan';     run = { Step-10-Verify } },
    @{ n = 11; name = 'Configure server .env';  run = { Step-11-Env } },
    @{ n = 12; name = 'Server unit tests';      run = { Step-12-ServerTests } },
    @{ n = 13; name = 'Server smoke check';     run = { Step-13-Smoke } },
    @{ n = 14; name = 'View the collection';    run = { Step-14-Share } }
)
$Total = $Steps.Count

Write-Host @'

================================================================================
  TinyFrens - Base Sepolia testnet runbook
================================================================================
  Each step waits for its on-chain receipt before continuing.
  Re-run at any point with  -From <step>  (deploys are reused from
  .secrets/testnet-deployment.json, so nothing is deployed twice).

  WHERE TO SEND ETH (testnet only): Step 2 prints YOUR deployer address.
  Mainnet FRENS (for later): 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3 on Base
================================================================================

'@ -ForegroundColor Cyan

foreach ($s in $Steps) {
    if ($From -gt 0 -and $s.n -lt $From) { continue }
    if ($To -gt 0 -and $s.n -gt $To) { break }
    try {
        & $s.run
    } catch {
        Write-Host ''
        Write-Host "  !! Step $($s.n) ($($s.name)) failed:" -ForegroundColor Red
        Write-Host "     $_" -ForegroundColor Red
        Write-Host "  Fix the cause, then resume:  .\scripts\testnet-economy-runbook.ps1 -From $($s.n)$(if ($SkipVerify) { ' -SkipVerify' })" -ForegroundColor Yellow
        exit 1
    }
    if ($s.n -lt $Total) { Pause-Step "Press Enter for step $($s.n + 1)" }
}

Write-Host @'

================================================================================
  Done - checklist
================================================================================
  [ ] Deployer funded on Base Sepolia (your address, not a shared wallet)
  [ ] TestFRENS + economy + TinyFrensNFT deployed (.secrets/testnet-deployment.json)
  [ ] Contracts verified on Basescan Sepolia (or re-run -From 10)
  [ ] server/.env has ECONOMY_MODE=testnet, FRENS_TOKEN, TINYFRENS_NFT_ADDRESS
  [ ] Gallery:  http://127.0.0.1:8080/gallery.html?nft=<nftAddress>
  [ ] Blockscout: https://base-sepolia.blockscout.com/token/<nftAddress>

  Re-run anytime: .\scripts\testnet-economy-runbook.ps1 -SkipWalletCreate
================================================================================

'@ -ForegroundColor Cyan
