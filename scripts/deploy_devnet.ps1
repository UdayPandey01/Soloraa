param(
    [string]$Keypair = $Env:SOLANA_KEYPAIR_PATH
)

$ErrorActionPreference = "Stop"

if (-not $Keypair) {
    throw "Set SOLANA_KEYPAIR_PATH or pass -Keypair <path>."
}

solana config set --url https://api.devnet.solana.com
solana config set --keypair $Keypair
solana airdrop 2

anchor build
anchor deploy --provider.cluster devnet
