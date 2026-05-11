//! Solora secure-execution enclave (v2).
//!
//! See `README.md` for deployment paths (Marlin Oyster / AWS Nitro). The
//! library entry points are `routes::router`, `state::AppState`, and the
//! per-stage modules.

pub mod attestation;
pub mod enclave_key;
pub mod error;
pub mod intent;
pub mod policy;
pub mod pyth;
pub mod routes;
pub mod solana_rpc;
pub mod solora_wallet;
pub mod state;
pub mod wormhole;
