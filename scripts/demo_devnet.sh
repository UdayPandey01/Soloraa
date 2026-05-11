#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MEASUREMENT="$(printf '11%.0s' {1..32})"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
export SOLORA_MEASUREMENT_HASH="$MEASUREMENT"

if [ -z "${SOLORA_ENCLAVE_URL:-}" ]; then
  echo "Set SOLORA_ENCLAVE_URL" >&2
  exit 1
fi
if [ -z "${SOLORA_PYTH_FEED_ID:-}" ]; then
  echo "Set SOLORA_PYTH_FEED_ID" >&2
  exit 1
fi

./scripts/gen_keys.sh
export SOLANA_KEYPAIR_PATH="./keys/authority.json"
export SOLORA_GOVERNOR_KEYPAIR_PATH="./keys/governor.json"

./scripts/gen_idl.sh

if [ ! -d "solora_relayer/node_modules" ]; then
  npm --prefix solora_relayer install
fi
npx tsx solora_relayer/ops.ts demo-devnet --pcr "$MEASUREMENT" --label devnet_demo --feed "$SOLORA_PYTH_FEED_ID"
