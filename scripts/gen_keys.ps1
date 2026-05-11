param(
    [string]$OutDir = "keys"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$authority = Join-Path $OutDir "authority.json"
$governor = Join-Path $OutDir "governor.json"

if (-not (Test-Path $authority)) {
    solana-keygen new --no-bip39-passphrase -o $authority
}
if (-not (Test-Path $governor)) {
    solana-keygen new --no-bip39-passphrase -o $governor
}
