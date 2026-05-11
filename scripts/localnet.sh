#!/usr/bin/env bash
# Boot a local Solana test validator with the Solora program preloaded.
# Foreground; press Ctrl-C to stop.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER="${1:-$ROOT_DIR/.localnet}"
RPC_PORT="${RPC_PORT:-8899}"
PROGRAM_SO="${SOLORA_PROGRAM_SO:-$ROOT_DIR/target/deploy/solora.so}"
PROGRAM_ID="${SOLORA_PROGRAM_ID:-DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf}"

if [ ! -f "$PROGRAM_SO" ]; then
  echo "Built program not found at $PROGRAM_SO."
  echo "Run scripts/build_all.sh (or 'cargo-build-sbf --manifest-path programs/solora/Cargo.toml') first."
  exit 1
fi

# Note: --bind-address 0.0.0.0 panics under Solana CLI 3.x (Agave); the test
# validator already binds to all interfaces by default for the RPC port.
exec solana-test-validator \
  --reset \
  --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" \
  --bpf-program "$PROGRAM_ID" "$PROGRAM_SO"
