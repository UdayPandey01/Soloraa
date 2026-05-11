#!/usr/bin/env bash
set -euo pipefail

cargo fmt
cargo test -p solora
cargo clippy -p solora --all-targets --all-features
anchor build
cargo build -p solora_enclave_v2

pushd solora_relayer >/dev/null
npm install
npm run smoke
popd >/dev/null
