#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-keys}"
mkdir -p "$OUT_DIR"

if [ ! -f "$OUT_DIR/authority.json" ]; then
  solana-keygen new --no-bip39-passphrase -o "$OUT_DIR/authority.json"
fi
if [ ! -f "$OUT_DIR/governor.json" ]; then
  solana-keygen new --no-bip39-passphrase -o "$OUT_DIR/governor.json"
fi
