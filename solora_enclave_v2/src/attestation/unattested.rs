use async_trait::async_trait;

use super::{AttestationDocument, AttestationProvider};
use crate::error::{EnclaveError, EnclaveResult};

/// Dev-only attestation backend that always errors. Selected when
/// `SOLORA_ATTESTATION_BACKEND` is unset or `unattested`. Production
/// deployments MUST set the backend to `marlin-oyster` (or another
/// real TEE provider) — the governor will refuse to register a wallet
/// against an `unattested` enclave.
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
