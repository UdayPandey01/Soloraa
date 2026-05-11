#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MEASUREMENT="$(printf '11%.0s' {1..32})"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
export SOLORA_MEASUREMENT_HASH="$MEASUREMENT"

./scripts/gen_keys.sh
export SOLANA_KEYPAIR_PATH="./keys/authority.json"
export SOLORA_GOVERNOR_KEYPAIR_PATH="./keys/governor.json"

./scripts/gen_idl.sh

if [ ! -d "solora_relayer/node_modules" ]; then
  npm --prefix solora_relayer install
fi

# Airdrop on localnet so the authority + governor can pay tx fees.
solana airdrop 5 \
  "$(solana-keygen pubkey "$SOLANA_KEYPAIR_PATH")" \
  --url "$SOLANA_RPC_URL" >/dev/null || true
solana airdrop 5 \
  "$(solana-keygen pubkey "$SOLORA_GOVERNOR_KEYPAIR_PATH")" \
  --url "$SOLANA_RPC_URL" >/dev/null || true

npx tsx solora_relayer/ops.ts demo-local --pcr "$MEASUREMENT" --label local_demo
