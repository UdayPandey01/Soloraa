

use async_trait::async_trait;

use crate::error::{EnclaveError, EnclaveResult};

#[derive(Debug, Clone)]
pub struct AttestationDocument {

    pub raw: Vec<u8>,

    pub backend: &'static str,
}

#[async_trait]
pub trait AttestationProvider: Send + Sync {
    /// Produce an attestation that binds `user_data` (typically the 32-byte
    /// enclave pubkey) to the running enclave's measurement (PCR0..PCR8 on

    async fn attest(&self, user_data: &[u8]) -> EnclaveResult<AttestationDocument>;

    fn backend_name(&self) -> &'static str;
}

/// Stub provider for non-enclave runs (local dev, CI). Returns an explicit
/// error rather than a fake document so misconfigured deployments surface
/// loudly instead of pretending to be attested.
pub struct Unattested;

#[async_trait]
impl AttestationProvider for Unattested {
    async fn attest(&self, _user_data: &[u8]) -> EnclaveResult<AttestationDocument> {
        Err(EnclaveError::AttestationUnavailable)
    }

    fn backend_name(&self) -> &'static str {
        "unattested"
    }
}
