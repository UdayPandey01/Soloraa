$ErrorActionPreference = "Stop"

cargo fmt
cargo test -p solora
cargo clippy -p solora --all-targets --all-features
anchor build
cargo build -p solora_enclave_v2

Push-Location solora_relayer
npm install
npm run smoke
Pop-Location
