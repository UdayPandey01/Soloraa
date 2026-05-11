$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$measurement = "11" * 32
$rpcUrl = $Env:SOLANA_RPC_URL
if (-not $rpcUrl) {
	$rpcUrl = "http://127.0.0.1:8899"
}
$Env:SOLANA_RPC_URL = $rpcUrl
$Env:SOLORA_MEASUREMENT_HASH = $measurement

.\scripts\gen_keys.ps1
$Env:SOLANA_KEYPAIR_PATH = ".\keys\authority.json"
$Env:SOLORA_GOVERNOR_KEYPAIR_PATH = ".\keys\governor.json"

.\scripts\gen_idl.ps1

Push-Location solora_relayer
npm install
npx tsx solora_relayer/ops.ts demo-local --pcr $measurement --label local_demo
Pop-Location
