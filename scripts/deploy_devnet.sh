#!/usr/bin/env bash
# scripts/deploy_devnet.sh
# Build + deploy the Solora program to Solana devnet. Idempotent.
#
# Env:
#   SOLANA_KEYPAIR_PATH   required — pays for deploy + becomes upgrade auth
#   SOLANA_RPC_URL        optional — defaults to https://api.devnet.solana.com
#   PROGRAM_KEYPAIR_PATH  optional — defaults to target/deploy/solora-keypair.json
#
# Usage:
#   SOLANA_KEYPAIR_PATH=./keys/authority.json ./scripts/deploy_devnet.sh

set -euo pipefail

KEYPAIR="${SOLANA_KEYPAIR_PATH:-}"
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR_PATH:-target/deploy/solora-keypair.json}"
PROGRAM_SO="target/deploy/solora.so"

if [ -z "$KEYPAIR" ]; then
    echo "Set SOLANA_KEYPAIR_PATH to a funded devnet keypair (e.g. ./keys/authority.json)." >&2
    exit 1
fi

solana config set --url "$RPC" --keypair "$KEYPAIR"

PUBKEY=$(solana-keygen pubkey "$KEYPAIR")
BAL=$(solana balance "$PUBKEY" --url "$RPC" | awk '{print $1}')
echo "Authority $PUBKEY  ·  balance: ${BAL} SOL"

# Devnet airdrops cap at 2 SOL; ignore failures (faucet often rate-limits).
if awk "BEGIN { exit ($BAL < 2) ? 0 : 1 }"; then
    echo "Topping up via faucet…"
    solana airdrop 2 "$PUBKEY" --url "$RPC" || true
fi

echo "→ Building SBF…"
cargo-build-sbf --manifest-path programs/solora/Cargo.toml

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    echo "Program keypair not found at $PROGRAM_KEYPAIR — first build must finish." >&2
    exit 1
fi

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "→ Deploying $PROGRAM_ID to $RPC"

solana program deploy \
    --url "$RPC" \
    --program-id "$PROGRAM_KEYPAIR" \
    --upgrade-authority "$KEYPAIR" \
    --buffer-authority "$KEYPAIR" \
    "$PROGRAM_SO"

echo
echo "✓ Deployed. Verify with:"
echo "    solana program show $PROGRAM_ID --url $RPC"
