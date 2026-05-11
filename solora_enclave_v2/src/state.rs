use std::sync::Arc;

use crate::attestation::AttestationProvider;
use crate::enclave_key::EnclaveKey;
use crate::pyth::PythHermesClient;
use crate::solana_rpc::SolanaRpc;
use crate::wormhole::GuardianSet;

/// Bundle of dependencies shared by every Axum handler. Trait objects let
/// integration tests inject in-memory fakes without touching the network.
pub struct AppState {
    pub key: Arc<EnclaveKey>,
    pub program_id: [u8; 32],
    pub rpc: Arc<dyn SolanaRpc>,
    pub hermes: Arc<dyn PythHermesClient>,
    pub guardians: Arc<GuardianSet>,
    pub attestation: Arc<dyn AttestationProvider>,
}

pub type SharedAppState = Arc<AppState>;
