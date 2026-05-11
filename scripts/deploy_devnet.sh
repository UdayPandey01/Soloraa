#!/usr/bin/env bash
set -euo pipefail

KEYPAIR="${SOLANA_KEYPAIR_PATH:-}"
if [ -z "$KEYPAIR" ]; then
  echo "Set SOLANA_KEYPAIR_PATH" >&2
  exit 1
fi

solana config set --url https://api.devnet.solana.com
solana config set --keypair "$KEYPAIR"
solana airdrop 2

anchor build
anchor deploy --provider.cluster devnet
