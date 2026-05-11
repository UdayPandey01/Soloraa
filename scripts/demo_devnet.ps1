$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$measurement = "11" * 32
$rpcUrl = $Env:SOLANA_RPC_URL
if (-not $rpcUrl) {
    $rpcUrl = "https://api.devnet.solana.com"
}
$Env:SOLANA_RPC_URL = $rpcUrl
$Env:SOLORA_MEASUREMENT_HASH = $measurement

if (-not $Env:SOLORA_ENCLAVE_URL) {
    throw "Set SOLORA_ENCLAVE_URL to the running enclave HTTP endpoint."
}
if (-not $Env:SOLORA_PYTH_FEED_ID) {
    throw "Set SOLORA_PYTH_FEED_ID for trade intent signing."
}

.\scripts\gen_keys.ps1
$Env:SOLANA_KEYPAIR_PATH = ".\keys\authority.json"
$Env:SOLORA_GOVERNOR_KEYPAIR_PATH = ".\keys\governor.json"

.\scripts\gen_idl.ps1

Push-Location solora_relayer
npm install
npx tsx solora_relayer/ops.ts demo-devnet --pcr $measurement --label devnet_demo --feed $Env:SOLORA_PYTH_FEED_ID
Pop-Location
