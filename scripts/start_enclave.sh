#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-env/enclave.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

cargo run -p solora_enclave_v2 --bin solora-enclave
