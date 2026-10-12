#Requires -Version 5.1
<#
.SYNOPSIS
  Download Foundry (forge, cast, anvil) for Windows into .tools/foundry (repo-local, gitignored).

.EXAMPLE
  .\scripts\install-foundry-windows.ps1
  .\scripts\install-foundry-windows.ps1 -Version v1.8.5
#>
param(
    [string]$Version = 'v1.8.5'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$BinDir = Join-Path $RepoRoot '.tools\foundry'
$ZipName = "foundry_${Version}_win32_amd64.zip"
$Url = "https://github.com/foundry-rs/foundry/releases/download/$Version/$ZipName"
$ZipPath = Join-Path $env:TEMP $ZipName

Write-Host "Installing Foundry $Version to $BinDir"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
if (Test-Path (Join-Path $BinDir 'forge.exe')) {
    Write-Host 'forge.exe already present; delete .tools\foundry to reinstall.'
    exit 0
}

Write-Host "Downloading $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing

Write-Host 'Extracting...'
if (Test-Path $BinDir) { Remove-Item $BinDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Expand-Archive -Path $ZipPath -DestinationPath $BinDir -Force

foreach ($exe in @('forge.exe', 'cast.exe', 'anvil.exe')) {
    if (-not (Test-Path (Join-Path $BinDir $exe))) {
        throw "Expected $exe in $BinDir after extract"
    }
}

$env:PATH = "$BinDir;$env:PATH"
Write-Host ''
& (Join-Path $BinDir 'forge.exe') --version
& (Join-Path $BinDir 'cast.exe') --version
Write-Host ''
Write-Host 'OK. For this PowerShell session, runbook adds .tools\foundry to PATH automatically.'
Write-Host 'Optional: add to your user PATH permanently:'
Write-Host "  $BinDir"
