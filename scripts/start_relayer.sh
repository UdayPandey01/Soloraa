#!/usr/bin/env bash
# Convenience wrapper for the relayer / admin CLI.
#
# Loads env/relayer.env (or $SOLORA_RELAYER_ENV) and forwards every argument
# straight to ops.ts. Run from the repo root.
#
# Examples:
#   ./scripts/start_relayer.sh demo-local
#   ./scripts/start_relayer.sh transfer <destination> --amount 1000000
#   ./scripts/start_relayer.sh init-registry
#   ./scripts/start_relayer.sh add-measurement --pcr <hex32> --label demo
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${SOLORA_RELAYER_ENV:-env/relayer.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ ! -d "solora_relayer/node_modules" ]; then
  npm --prefix solora_relayer install
fi

if [ "$#" -eq 0 ]; then
  echo "usage: $(basename "$0") <ops-command> [args...]" >&2
  echo "       see 'npx tsx solora_relayer/ops.ts' for the full list" >&2
  exit 64
fi

exec npx tsx solora_relayer/ops.ts "$@"
