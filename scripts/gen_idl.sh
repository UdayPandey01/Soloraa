#!/usr/bin/env bash
# Sync the Anchor IDL into both canonical locations.
#
# The hand-maintained source of truth is `solora_relayer/solora.json` — the
# off-chain `anchor build` IDL pass currently triggers a multi-minute vendored-
# OpenSSL native build via litesvm's dev-deps, so we don't gate the demo on it.
# The on-chain program already encodes its discriminators at compile time;
# the IDL is purely the off-chain client contract.
#
# Override: set SOLORA_IDL_GEN=anchor to run `anchor build` and overwrite both
# locations from target/idl/solora.json.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SOURCE="${SOLORA_IDL_SOURCE:-solora_relayer/solora.json}"
DEST="target/idl/solora.json"

if [ "${SOLORA_IDL_GEN:-sync}" = "anchor" ]; then
  anchor build
  cp -f "target/idl/solora.json" "solora_relayer/solora.json"
  echo "Anchor build completed; IDL synced to solora_relayer/solora.json"
  exit 0
fi

if [ ! -f "$SOURCE" ]; then
  echo "Source IDL $SOURCE not found." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp -f "$SOURCE" "$DEST"
echo "IDL synced: $SOURCE -> $DEST"
